import { describe, expect, it } from 'vitest';
import { PlaybackClock } from './clock';

describe('PlaybackClock', () => {
  it('停止中は位置が動かない', () => {
    const clock = new PlaybackClock(100);
    clock.seek(0, 10);
    expect(clock.positionAt(5)).toBe(10);
  });

  it('再生中は経過時間に応じて進む', () => {
    const clock = new PlaybackClock(100);
    clock.seek(0, 10);
    clock.play(2);
    expect(clock.positionAt(5)).toBeCloseTo(13);
  });

  it('一時停止で位置を保持する', () => {
    const clock = new PlaybackClock(100);
    clock.play(0);
    clock.pause(3);
    expect(clock.positionAt(10)).toBeCloseTo(3);
  });

  it('再生レートを途中で変えても位置が連続する', () => {
    const clock = new PlaybackClock(100);
    clock.play(0);
    clock.setRate(10, 1.5);
    expect(clock.positionAt(10)).toBeCloseTo(10);
    expect(clock.positionAt(12)).toBeCloseTo(13);
  });

  it('範囲外のシークを丸める', () => {
    const clock = new PlaybackClock(100);
    clock.seek(0, -5);
    expect(clock.positionAt(0)).toBe(0);
    clock.seek(0, 500);
    expect(clock.positionAt(0)).toBe(100);
  });

  it('曲の終わりで止まり、終了を検出する', () => {
    const clock = new PlaybackClock(10);
    clock.play(0);
    expect(clock.hasEnded(9)).toBe(false);
    expect(clock.hasEnded(10)).toBe(true);
    expect(clock.positionAt(50)).toBe(10);
  });

  it('ループ中は終端で先頭へ折り返す', () => {
    const clock = new PlaybackClock(100);
    clock.seek(0, 8);
    clock.setLoop(0, { start: 8, end: 10 });
    clock.play(0);
    expect(clock.positionAt(1)).toBeCloseTo(9);
    expect(clock.positionAt(2.5)).toBeCloseTo(8.5);
    expect(clock.positionAt(4)).toBeCloseTo(8);
    expect(clock.hasEnded(1000)).toBe(false);
  });

  it('ループの終端より先で設定すると先頭へ戻る', () => {
    const clock = new PlaybackClock(100);
    clock.seek(0, 20);
    clock.setLoop(0, { start: 8, end: 10 });
    expect(clock.positionAt(0)).toBe(8);
  });

  it('ループを外すと折り返さずに進む', () => {
    const clock = new PlaybackClock(100);
    clock.seek(0, 8);
    clock.setLoop(0, { start: 8, end: 10 });
    clock.play(0);
    clock.setLoop(1.5, null);
    expect(clock.positionAt(3)).toBeCloseTo(11);
  });

  it('再生レートが 2 倍のとき、ループの折り返しも実時間の半分で起きる', () => {
    const clock = new PlaybackClock(100);
    clock.seek(0, 8);
    clock.setLoop(0, { start: 8, end: 10 });
    clock.setRate(0, 2);
    clock.play(0);
    expect(clock.positionAt(0.75)).toBeCloseTo(9.5);
    expect(clock.positionAt(1.25)).toBeCloseTo(8.5);
  });
});
