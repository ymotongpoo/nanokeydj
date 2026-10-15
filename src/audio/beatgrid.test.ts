import { describe, expect, it } from 'vitest';
import {
  beatLoopRegion,
  beatPhase,
  beatTimesIn,
  nearestBeat,
  normalizeFirstBeat,
  phaseCorrection,
  tapBpm,
} from './beatgrid';

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

describe('beatLoopRegion', () => {
  it('4 拍ループは位置の手前の拍から 4 拍分', () => {
    const { start, end } = beatLoopRegion(10.3, 0.15, 120, 4);
    expect(start).toBeCloseTo(10.15);
    expect(end).toBeCloseTo(12.15);
  });

  it('半拍ループは半拍の区切りに揃え、位置を含む', () => {
    const { start, end } = beatLoopRegion(10.3, 0.15, 120, 0.5);
    expect(start).toBeCloseTo(10.15);
    expect(end).toBeCloseTo(10.4);
    const later = beatLoopRegion(10.42, 0.15, 120, 0.5);
    expect(later.start).toBeCloseTo(10.4);
    expect(later.end).toBeCloseTo(10.65);
  });

  it('どの位置でもループが位置を含む', () => {
    for (const beats of [0.5, 1, 2, 4, 8, 16, 32]) {
      for (let p = 0.2; p < 40; p += 0.137) {
        const { start, end } = beatLoopRegion(p, 0.31, 127, beats);
        expect(start).toBeLessThanOrEqual(p + 1e-9);
        expect(end).toBeGreaterThan(p);
        expect(end - start).toBeCloseTo((beats * 60) / 127);
      }
    }
  });

  it('曲頭より前に始点が出ない', () => {
    const { start } = beatLoopRegion(0.05, 0.4, 120, 4);
    expect(start).toBeGreaterThanOrEqual(0);
  });
});

describe('normalizeFirstBeat', () => {
  it('位置を 0 以上 1 拍未満に収める', () => {
    expect(normalizeFirstBeat(10.3, 120)).toBeCloseTo(0.3);
    expect(normalizeFirstBeat(0.2, 120)).toBeCloseTo(0.2);
    expect(normalizeFirstBeat(-0.1, 120)).toBeCloseTo(0.4);
  });

  it('収めたあとも同じグリッドを指す', () => {
    const first = normalizeFirstBeat(37.77, 126);
    expect(beatPhase(37.77, first, 126)).toBeCloseTo(0, 6);
  });
});

describe('tapBpm', () => {
  const taps = (intervals: number[], start = 1000) => {
    const out = [start];
    for (const i of intervals) out.push(out.at(-1)! + i);
    return out;
  };

  it('叩く回数が足りなければ null', () => {
    expect(tapBpm([])).toBeNull();
    expect(tapBpm([1000])).toBeNull();
    expect(tapBpm(taps([500]))).toBeNull();
  });

  it('等間隔なら、その間隔の BPM', () => {
    expect(tapBpm(taps([500, 500, 500]))).toBeCloseTo(120);
    expect(tapBpm(taps([468, 468, 468, 468]))).toBeCloseTo(128.2, 0);
  });

  it('1 回だけ大きくずれても、中央値で外れ値を無視する', () => {
    expect(tapBpm(taps([500, 500, 620, 500, 500]))).toBeCloseTo(120);
  });

  it('長く空いたら、そこから叩き直したものとして扱う', () => {
    const early = taps([400, 400, 400]);
    const restart = taps([500, 500, 500], early.at(-1)! + 5000);
    expect(tapBpm([...early, ...restart])).toBeCloseTo(120);
  });

  it('直近 8 回だけを見る', () => {
    const slow = taps([600, 600, 600, 600]);
    const fast = taps([500, 500, 500, 500, 500, 500, 500], slow.at(-1)! + 500);
    expect(tapBpm([...slow, ...fast])).toBeCloseTo(120);
  });
});
