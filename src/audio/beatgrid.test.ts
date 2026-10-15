import { describe, expect, it } from 'vitest';
import { beatPhase, beatTimesIn, nearestBeat, phaseCorrection } from './beatgrid';

describe('beatPhase', () => {
  it('拍の頭で 0、半拍で 0.5', () => {
    expect(beatPhase(0.25, 0.25, 120)).toBeCloseTo(0);
    expect(beatPhase(0.5, 0.25, 120)).toBeCloseTo(0.5);
  });

  it('最初の拍より前でも 0 以上 1 未満', () => {
    const phase = beatPhase(0, 0.3, 120);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
    expect(phase).toBeCloseTo(0.4);
  });
});

describe('nearestBeat', () => {
  it('いちばん近い拍に丸める', () => {
    expect(nearestBeat(1.1, 0, 120)).toBeCloseTo(1);
    expect(nearestBeat(1.3, 0, 120)).toBeCloseTo(1.5);
  });
});

describe('beatTimesIn', () => {
  it('範囲内の拍を返す', () => {
    const times = beatTimesIn(0.1, 120, 1, 2.2);
    expect(times).toHaveLength(3);
    expect(times[0]).toBeCloseTo(1.1);
    expect(times[2]).toBeCloseTo(2.1);
  });

  it('範囲に拍がなければ空', () => {
    expect(beatTimesIn(0, 60, 0.1, 0.9)).toEqual([]);
  });
});

describe('phaseCorrection', () => {
  it('相手が少し先にいれば前へ、少し後ろなら後ろへ動かす', () => {
    // 自分は拍の 0.1 拍後ろ、相手は拍の頭ちょうど。
    expect(phaseCorrection(1.05, 0, 120, 2, 0, 120)).toBeCloseTo(-0.05);
    expect(phaseCorrection(0.95, 0, 120, 2, 0, 120)).toBeCloseTo(0.05);
  });

  it('動かす量は半拍以内に収まる', () => {
    for (let p = 0; p < 1; p += 0.05) {
      const shift = phaseCorrection(p, 0, 120, 0.3, 0.1, 128);
      expect(Math.abs(shift)).toBeLessThanOrEqual(0.25 + 1e-9);
    }
  });

  it('補正後は位相が一致する', () => {
    const shift = phaseCorrection(3.37, 0.12, 124, 10.61, 0.3, 128);
    expect(beatPhase(3.37 + shift, 0.12, 124)).toBeCloseTo(beatPhase(10.61, 0.3, 128), 6);
  });
});
