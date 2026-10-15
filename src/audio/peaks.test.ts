import { describe, expect, it } from 'vitest';
import { computePeaks } from './peaks';

describe('computePeaks', () => {
  it('バケットごとの最小値と最大値を返す', () => {
    const samples = new Float32Array([0, 1, -1, 0.5, 0.2, -0.4, 0, 0]);
    const { data, buckets } = computePeaks(samples, 4);
    expect(buckets).toBe(4);
    expect([...data]).toEqual([0, 1, -1, 0.5, -0.4, 0.2, 0, 0].map((v) => Math.fround(v)));
  });

  it('サンプル数がバケット数より少なくても落ちない', () => {
    const { data } = computePeaks(new Float32Array([0.5, -0.5]), 8);
    expect(data).toHaveLength(16);
    for (const v of data) expect(Number.isFinite(v)).toBe(true);
  });
});
