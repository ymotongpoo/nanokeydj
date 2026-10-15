import { describe, expect, it, vi } from 'vitest';
import type { KeyValueStorage } from '../control/controller';
import { TrackStore, trackKey } from '../audio/track-store';
import { BpmCache, LibraryAnalyzer, fileCacheKey, type AnalyzerDeps } from './analyzer';
import { Library } from './library';

function memoryStorage(): KeyValueStorage {
  const data: Record<string, string> = {};
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

const file = (name: string, size = 100) => ({ name, size, type: 'audio/mpeg', lastModified: 1 }) as unknown as File;

function setup(overrides: Partial<AnalyzerDeps> = {}) {
  const library = new Library();
  const store = new TrackStore(memoryStorage());
  const cache = new BpmCache(memoryStorage());
  const decode = vi.fn(async (f: File) => ({ duration: f.size / 10, sampleRate: 44100, mono: new Float32Array(4) }));
  const analyze = vi.fn(async () => ({ bpm: 124, firstBeat: 0.2, confidence: 10 }));
  const analyzer = new LibraryAnalyzer(library, { decode, analyze, store, cache, ...overrides });
  return { library, store, cache, decode, analyze, analyzer };
}

/** 解析ループが落ち着くまで待つ。 */
async function settle(library: Library) {
  for (let i = 0; i < 50 && library.pendingCount > 0; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('LibraryAnalyzer', () => {
  it('追加された曲を解析して、BPM と長さを一覧に書く', async () => {
    const { library } = setup();
    library.add([file('a.mp3', 600)]);
    await settle(library);
    const entry = library.list()[0]!;
    expect(entry).toMatchObject({ status: 'done', bpm: 124, duration: 60 });
  });

  it('複数の曲を、1 曲ずつ順に解析する', async () => {
    let active = 0;
    let maxActive = 0;
    const decode = vi.fn(async (f: File) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return { duration: f.size / 10, sampleRate: 44100, mono: new Float32Array(4) };
    });
    const { library } = setup({ decode });
    library.add([file('a.mp3', 100), file('b.mp3', 200), file('c.mp3', 300)]);
    await settle(library);
    expect(decode).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
    expect(library.list().every((e) => e.status === 'done')).toBe(true);
  });

  it('結果を曲ごとの保存へ書き、デッキに載せたときに戻せるようにする', async () => {
    const { library, store } = setup();
    library.add([file('Song.mp3', 600)]);
    await settle(library);
    expect(store.get(trackKey('Song', 60))).toMatchObject({ bpm: 124, firstBeat: 0.2, cuePoint: 0.2 });
    expect(store.get(trackKey('Song', 60))?.hotcues).toHaveLength(8);
  });

  it('前に手直しした状態があれば、上書きしない', async () => {
    const { library, store } = setup();
    store.set(trackKey('Song', 60), { bpm: 120, firstBeat: 0.5, cuePoint: 3, hotcues: [9, null, null, null, null, null, null, null] });
    library.add([file('Song.mp3', 600)]);
    await settle(library);
    expect(store.get(trackKey('Song', 60))).toMatchObject({ bpm: 120, firstBeat: 0.5, cuePoint: 3 });
    expect(library.list()[0]?.bpm).toBe(120);
  });

  it('解析済みのファイルはキャッシュから引き、デコードしない', async () => {
    const first = setup();
    first.library.add([file('a.mp3', 600)]);
    await settle(first.library);

    const decode = vi.fn();
    const second = setup({ decode, cache: first.cache });
    second.library.add([file('a.mp3', 600)]);
    await settle(second.library);
    expect(decode).not.toHaveBeenCalled();
    expect(second.library.list()[0]).toMatchObject({ status: 'done', bpm: 124, duration: 60 });
  });

  it('BPM が検出できなかった曲も、キャッシュして再試行しない', async () => {
    const analyze = vi.fn(async () => null);
    const { library, cache } = setup({ analyze });
    library.add([file('a.mp3', 600)]);
    await settle(library);
    expect(library.list()[0]).toMatchObject({ status: 'done', bpm: null });
    expect(cache.get(fileCacheKey(file('a.mp3', 600)))).toEqual({ bpm: null, duration: 60 });
  });

  it('読み込みに失敗した曲は error にして、次の曲へ進む', async () => {
    const decode = vi.fn(async (f: File) => {
      if (f.name === 'bad.mp3') throw new Error('decode failed');
      return { duration: 10, sampleRate: 44100, mono: new Float32Array(4) };
    });
    const { library } = setup({ decode });
    library.add([file('bad.mp3'), file('good.mp3', 200)]);
    await settle(library);
    const byName = Object.fromEntries(library.list().map((e) => [e.name, e.status]));
    expect(byName).toEqual({ bad: 'error', good: 'done' });
  });

  it('解析中に追加された曲も、続けて解析する', async () => {
    const { library } = setup();
    library.add([file('a.mp3', 100)]);
    library.add([file('b.mp3', 200)]);
    await settle(library);
    expect(library.list().map((e) => e.status)).toEqual(['done', 'done']);
  });
});

describe('BpmCache', () => {
  it('保存して読み戻せ、壊れたデータは無視する', () => {
    const storage = memoryStorage();
    new BpmCache(storage).set('k', { bpm: 128, duration: 200 });
    expect(new BpmCache(storage).get('k')).toEqual({ bpm: 128, duration: 200 });
    storage.setItem('nanokeydj.library-bpm.v1', '{oops');
    expect(new BpmCache(storage).get('k')).toBeUndefined();
  });

  it('形の違うデータは無視する', () => {
    const storage = memoryStorage();
    storage.setItem('nanokeydj.library-bpm.v1', JSON.stringify({ k: { bpm: 'x', duration: 1 } }));
    expect(new BpmCache(storage).get('k')).toBeUndefined();
  });
});
