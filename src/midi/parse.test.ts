import { describe, expect, it } from 'vitest';
import { describeMessage, noteName, parseMidiMessage } from './parse';

describe('parseMidiMessage', () => {
  it('Control Change を読む', () => {
    expect(parseMidiMessage([0xb0, 16, 64])).toEqual({
      type: 'cc',
      channel: 1,
      controller: 16,
      value: 64,
    });
  });

  it('チャンネルを 1 始まりで返す', () => {
    expect(parseMidiMessage([0x99, 36, 100])).toEqual({
      type: 'noteOn',
      channel: 10,
      note: 36,
      velocity: 100,
    });
  });

  it('ベロシティ 0 のノートオンをノートオフとして扱う', () => {
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({
      type: 'noteOff',
      channel: 1,
      note: 60,
      velocity: 0,
    });
  });

  it('ピッチベンドを 14bit で組み立てる', () => {
    expect(parseMidiMessage([0xe0, 0x00, 0x40])).toEqual({
      type: 'pitchBend',
      channel: 1,
      value: 8192,
    });
    expect(parseMidiMessage([0xe0, 0x7f, 0x7f])).toEqual({
      type: 'pitchBend',
      channel: 1,
      value: 16383,
    });
  });

  it('リアルタイムメッセージを無視する', () => {
    expect(parseMidiMessage([0xf8])).toBeNull();
    expect(parseMidiMessage([0xfe])).toBeNull();
  });

  it('空のデータとステータスバイトのないデータを無視する', () => {
    expect(parseMidiMessage([])).toBeNull();
    expect(parseMidiMessage([0x10, 0x20])).toBeNull();
  });

  it('SysEx の長さを返す', () => {
    expect(parseMidiMessage([0xf0, 0x42, 0x01, 0xf7])).toEqual({ type: 'sysex', length: 4 });
  });

  it('Uint8Array も受け取れる', () => {
    expect(parseMidiMessage(new Uint8Array([0xb1, 7, 127]))).toEqual({
      type: 'cc',
      channel: 2,
      controller: 7,
      value: 127,
    });
  });
});

describe('noteName', () => {
  it('60 を C4 とする', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(36)).toBe('C2');
    expect(noteName(61)).toBe('C#4');
  });
});

describe('describeMessage', () => {
  it('CC を説明する', () => {
    expect(describeMessage({ type: 'cc', channel: 1, controller: 16, value: 64 })).toBe(
      'ch1 CC 16 = 64',
    );
  });
});
