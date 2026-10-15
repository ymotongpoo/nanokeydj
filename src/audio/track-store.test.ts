import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from '../control/controller';
import { TRACKS_STORAGE_KEY, TrackStore, trackKey, type TrackState } from './track-store';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  const storage: KeyValueStorage & { data: Record<string, string> } = {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
  return storage;
}

const state = (overrides: Partial<TrackState> = {}): TrackState => ({
  bpm: 124,
  firstBeat: 0.15,
  cuePoint: 0.15,
  hotcues: [12, null, null, null, null, null, null, null],
  ...overrides,
});

describe('trackKey', () => {
  it('曲名と長さ（ミリ秒）から作る', () => {
    expect(trackKey('Song', 62.5855)).toBe('Song|62586');
  });

  it('長さが違えば別の曲', () => {
    expect(trackKey('Song', 60)).not.toBe(trackKey('Song', 61));
  });
});

describe('TrackStore', () => {
  it('保存して読み戻せる', () => {
    const store = new TrackStore(memoryStorage());
    store.set('a', state());
    expect(store.get('a')).toEqual(state());
    expect(store.get('b')).toBeUndefined();
  });

  it('保存先が違う TrackStore にも引き継がれる', () => {
    const storage = memoryStorage();
    new TrackStore(storage).set('a', state({ bpm: 90 }));
    expect(new TrackStore(storage).get('a')?.bpm).toBe(90);
  });

  it('壊れたデータや形の違うデータは無視する', () => {
    expect(new TrackStore(memoryStorage({ [TRACKS_STORAGE_KEY]: '{oops' })).get('a')).toBeUndefined();
    expect(new TrackStore(memoryStorage({ [TRACKS_STORAGE_KEY]: '[1,2]' })).get('a')).toBeUndefined();
    expect(
      new TrackStore(memoryStorage({ [TRACKS_STORAGE_KEY]: JSON.stringify({ a: { bpm: 'x' } }) })).get('a'),
    ).toBeUndefined();
  });

  it('件数が上限を超えたら、古いものから捨てる', () => {
    const store = new TrackStore(memoryStorage());
    for (let i = 0; i < 305; i++) store.set(`t${i}`, state({ firstBeat: i / 1000 }));
    expect(store.get('t0')).toBeUndefined();
    expect(store.get('t4')).toBeUndefined();
    expect(store.get('t5')).toBeDefined();
    expect(store.get('t304')).toBeDefined();
  });

  it('更新した曲は新しい側へ移る', () => {
    const store = new TrackStore(memoryStorage());
    for (let i = 0; i < 300; i++) store.set(`t${i}`, state());
    store.set('t0', state({ bpm: 99 }));
    store.set('extra', state());
    expect(store.get('t0')?.bpm).toBe(99);
    expect(store.get('t1')).toBeUndefined();
  });

  it('保存先がなくても落ちない', () => {
    const store = new TrackStore(null);
    expect(() => store.set('a', state())).not.toThrow();
    expect(store.get('a')).toBeUndefined();
  });

  it('保存に失敗しても落ちない', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    expect(() => new TrackStore(storage).set('a', state())).not.toThrow();
  });
});
