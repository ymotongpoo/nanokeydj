import { describe, expect, it, vi } from 'vitest';
import { Library, displayName, formatDuration, isAudioFile } from './library';

const file = (name: string, size = 100, type = '', lastModified = 1) =>
  ({ name, size, type, lastModified }) as unknown as File;

describe('displayName', () => {
  it('拡張子を除く', () => {
    expect(displayName({ name: 'Track 01.mp3' })).toBe('Track 01');
    expect(displayName({ name: 'a.b.c.wav' })).toBe('a.b.c');
    expect(displayName({ name: 'noext' })).toBe('noext');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [59.4, '0:59'],
    [60, '1:00'],
    [185, '3:05'],
    [3725, '62:05'],
    [-5, '0:00'],
  ])('%f 秒を %s と表示する', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe('isAudioFile', () => {
  it('MIME タイプか拡張子で音声と判定する', () => {
    expect(isAudioFile({ name: 'x', type: 'audio/mpeg' })).toBe(true);
    expect(isAudioFile({ name: 'x.FLAC', type: '' })).toBe(true);
    expect(isAudioFile({ name: 'x.m4a', type: '' })).toBe(true);
  });

  it('音声以外は除く', () => {
    expect(isAudioFile({ name: 'cover.jpg', type: 'image/jpeg' })).toBe(false);
    expect(isAudioFile({ name: 'notes.txt', type: '' })).toBe(false);
    expect(isAudioFile({ name: 'README', type: '' })).toBe(false);
  });
});

describe('Library', () => {
  it('音声ファイルだけを追加し、件数を返す', () => {
    const library = new Library();
    expect(library.add([file('a.mp3'), file('cover.jpg', 1, 'image/jpeg'), file('b.wav')])).toBe(2);
    expect(library.size).toBe(2);
  });

  it('同じファイルは重複して追加しない', () => {
    const library = new Library();
    library.add([file('a.mp3', 100, '', 5)]);
    expect(library.add([file('a.mp3', 100, '', 5)])).toBe(0);
    expect(library.add([file('a.mp3', 200, '', 5)])).toBe(1);
    expect(library.size).toBe(2);
  });

  it('最初に追加した曲が選択される', () => {
    const library = new Library();
    library.add([file('b.mp3'), file('a.mp3')]);
    expect(library.selected?.name).toBe('b');
  });

  it('追加のたびに変更を通知する', () => {
    const library = new Library();
    const listener = vi.fn();
    library.onChange.on(listener);
    library.add([file('a.mp3')]);
    library.add([file('cover.jpg', 1, 'image/jpeg')]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('名前順は数字を数として比べる', () => {
    const library = new Library();
    library.add([file('Track 10.mp3'), file('Track 2.mp3'), file('Track 1.mp3')]);
    library.sort = 'name';
    expect(library.list().map((e) => e.name)).toEqual(['Track 1', 'Track 2', 'Track 10']);
  });

  it('BPM 順は BPM が分からない曲を最後に置く', () => {
    const library = new Library();
    library.add([file('a.mp3'), file('b.mp3'), file('c.mp3'), file('d.mp3')]);
    const [a, b, c, d] = library.list();
    library.update(a!.id, { bpm: 128 });
    library.update(c!.id, { bpm: 90 });
    library.update(d!.id, { bpm: 128 });
    library.sort = 'bpm';
    expect(library.list().map((e) => e.name)).toEqual(['c', 'a', 'd', 'b']);
    expect(b!.bpm).toBeNull();
  });

  it('選択は並べ替えても同じ曲に付いてくる', () => {
    const library = new Library();
    library.add([file('b.mp3'), file('a.mp3')]);
    library.sort = 'name';
    expect(library.selected?.name).toBe('b');
  });

  it('選択を上下に動かし、端で止まる', () => {
    const library = new Library();
    library.add([file('a.mp3'), file('b.mp3'), file('c.mp3')]);
    library.move(1);
    expect(library.selected?.name).toBe('b');
    library.move(5);
    expect(library.selected?.name).toBe('c');
    library.move(-10);
    expect(library.selected?.name).toBe('a');
  });

  it('空のときの操作は何もしない', () => {
    const library = new Library();
    expect(() => library.move(1)).not.toThrow();
    expect(library.selected).toBeNull();
  });

  it('解析待ちの曲を順に返し、数を数える', () => {
    const library = new Library();
    library.add([file('a.mp3'), file('b.mp3')]);
    const first = library.nextPending()!;
    expect(first.name).toBe('a');
    library.update(first.id, { status: 'analyzing' });
    expect(library.nextPending()?.name).toBe('b');
    expect(library.pendingCount).toBe(2);
    library.update(first.id, { status: 'done', bpm: 120 });
    expect(library.pendingCount).toBe(1);
  });

  it('一覧を空にできる', () => {
    const library = new Library();
    library.add([file('a.mp3')]);
    library.clear();
    expect(library.size).toBe(0);
    expect(library.selected).toBeNull();
  });
});
