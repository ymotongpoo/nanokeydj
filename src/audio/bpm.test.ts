import { describe, expect, it } from 'vitest';
import { detectBpm } from './bpm';
import { renderDemoTrack } from './demo';

const SAMPLE_RATE = 22050;

/** 周期的な拍の位置との差（秒）。-周期/2〜周期/2 に丸める。 */
function phaseError(detected: number, expected: number, beatSeconds: number): number {
  let diff = (detected - expected) % beatSeconds;
  if (diff > beatSeconds / 2) diff -= beatSeconds;
  if (diff < -beatSeconds / 2) diff += beatSeconds;
  return diff;
}

describe('detectBpm', () => {
  it.each([
    { bpm: 124, leadIn: 0.15 },
    { bpm: 128, leadIn: 0.32 },
    { bpm: 100, leadIn: 0.05 },
    { bpm: 140, leadIn: 0.2 },
  ])('$bpm BPM の 4 つ打ちを検出する', ({ bpm, leadIn }) => {
    const [left] = renderDemoTrack(SAMPLE_RATE, { bpm, bars: 24, bass: [55, 65.41], leadIn });
    const result = detectBpm(left, SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(Math.abs(result!.bpm - bpm)).toBeLessThan(0.15);
    expect(Math.abs(phaseError(result!.firstBeat, leadIn, 60 / bpm))).toBeLessThan(0.02);
  });

  it('44.1 kHz でも同じ結果になる', () => {
    const [left] = renderDemoTrack(44100, { bpm: 126, bars: 20, bass: [55], leadIn: 0.1 });
    const result = detectBpm(left, 44100);
    expect(Math.abs(result!.bpm - 126)).toBeLessThan(0.15);
    expect(Math.abs(phaseError(result!.firstBeat, 0.1, 60 / 126))).toBeLessThan(0.02);
  });

  it('ノイズが乗っていても検出できる', () => {
    const [left] = renderDemoTrack(SAMPLE_RATE, { bpm: 122, bars: 24, bass: [55, 49], leadIn: 0.1 });
    let seed = 7;
    const noisy = left.map((v) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return v + (seed / 0x80000000 - 1) * 0.1;
    });
    const result = detectBpm(noisy, SAMPLE_RATE);
    expect(Math.abs(result!.bpm - 122)).toBeLessThan(0.2);
  });

  it('firstBeat は 0 以上で 1 拍より短い', () => {
    const [left] = renderDemoTrack(SAMPLE_RATE, { bpm: 128, bars: 24, bass: [55], leadIn: 1.234 });
    const result = detectBpm(left, SAMPLE_RATE)!;
    expect(result.firstBeat).toBeGreaterThanOrEqual(0);
    expect(result.firstBeat).toBeLessThan(60 / 128);
  });

  it('長い曲は中央付近だけを解析しても、曲頭基準の位置を返す', () => {
    const [left] = renderDemoTrack(SAMPLE_RATE, { bpm: 128, bars: 40, bass: [55], leadIn: 0.3 });
    const result = detectBpm(left, SAMPLE_RATE, { maxSeconds: 30 })!;
    expect(Math.abs(result.bpm - 128)).toBeLessThan(0.15);
    expect(Math.abs(phaseError(result.firstBeat, 0.3, 60 / 128))).toBeLessThan(0.025);
  });

  it('無音と短すぎる音源は null', () => {
    expect(detectBpm(new Float32Array(SAMPLE_RATE * 30), SAMPLE_RATE)).toBeNull();
    expect(detectBpm(new Float32Array(SAMPLE_RATE * 3).fill(0.1), SAMPLE_RATE)).toBeNull();
  });
});
