import { describe, expect, it } from 'vitest';
import {
  crossfaderGains,
  cueMixGains,
  dbToGain,
  echoTimeFor,
  eqGainDb,
  filterCutoffs,
  tempoRate,
  volumeGain,
} from './curves';

describe('eqGainDb', () => {
  it('中央で 0 dB、左端でキル、右端で +6 dB', () => {
    expect(eqGainDb(0.5)).toBe(0);
    expect(eqGainDb(0)).toBe(-40);
    expect(eqGainDb(1)).toBe(6);
  });

  it('範囲外の値を丸める', () => {
    expect(eqGainDb(-1)).toBe(-40);
    expect(eqGainDb(2)).toBe(6);
  });

  it('単調に増える', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const db = eqGainDb(i / 100);
      expect(db).toBeGreaterThanOrEqual(previous);
      previous = db;
    }
  });
});

describe('volumeGain', () => {
  it('両端は 0 と 1', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(1)).toBe(1);
  });

  it('中央は約 -12 dB', () => {
    expect(20 * Math.log10(volumeGain(0.5))).toBeCloseTo(-12.04, 1);
  });
});

describe('filterCutoffs', () => {
  it('中央付近は素通し', () => {
    expect(filterCutoffs(0.5)).toEqual({ lowpassHz: 20000, highpassHz: 20 });
    expect(filterCutoffs(63 / 127)).toEqual({ lowpassHz: 20000, highpassHz: 20 });
    expect(filterCutoffs(64 / 127)).toEqual({ lowpassHz: 20000, highpassHz: 20 });
  });

  it('左へ回すとローパスだけが下がる', () => {
    const left = filterCutoffs(0);
    expect(left.lowpassHz).toBeCloseTo(200, 3);
    expect(left.highpassHz).toBe(20);
    expect(filterCutoffs(0.25).lowpassHz).toBeGreaterThan(left.lowpassHz);
  });

  it('右へ回すとハイパスだけが上がる', () => {
    const right = filterCutoffs(1);
    expect(right.highpassHz).toBeCloseTo(4000, 3);
    expect(right.lowpassHz).toBe(20000);
  });
});

describe('crossfaderGains', () => {
  it('両端で片側だけが鳴る', () => {
    for (const curve of ['smooth', 'sharp', 'linear'] as const) {
      expect(crossfaderGains(0, curve).a).toBeCloseTo(1);
      expect(crossfaderGains(0, curve).b).toBeCloseTo(0);
      expect(crossfaderGains(1, curve).a).toBeCloseTo(0);
      expect(crossfaderGains(1, curve).b).toBeCloseTo(1);
    }
  });

  it('smooth は中央で等パワー', () => {
    const { a, b } = crossfaderGains(0.5, 'smooth');
    expect(a * a + b * b).toBeCloseTo(1);
  });

  it('sharp は中央で両方が全開', () => {
    expect(crossfaderGains(0.5, 'sharp')).toEqual({ a: 1, b: 1 });
  });

  it('linear は中央で半分ずつ', () => {
    expect(crossfaderGains(0.5, 'linear')).toEqual({ a: 0.5, b: 0.5 });
  });
});

describe('tempoRate', () => {
  it('中央は等速で、7bit の隣り合う値も不感帯に入る', () => {
    expect(tempoRate(0.5, 8)).toBe(1);
    expect(tempoRate(63 / 127, 8)).toBe(1);
    expect(tempoRate(64 / 127, 8)).toBe(1);
  });

  it('反転時は上いっぱいで -8%、下いっぱいで +8%', () => {
    expect(tempoRate(1, 8)).toBeCloseTo(0.92);
    expect(tempoRate(0, 8)).toBeCloseTo(1.08);
  });

  it('反転なしでは上いっぱいで +8%', () => {
    expect(tempoRate(1, 8, false)).toBeCloseTo(1.08);
  });

  it('レンジに比例する', () => {
    expect(tempoRate(0, 16)).toBeCloseTo(1.16);
  });
});

describe('dbToGain', () => {
  it('-6 dB は約半分', () => {
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
    expect(dbToGain(0)).toBe(1);
  });
});

describe('cueMixGains', () => {
  it('両端で片方だけが鳴り、中央は等パワー', () => {
    expect(cueMixGains(0)).toEqual({ cue: 1, master: 0 });
    expect(cueMixGains(1).cue).toBeCloseTo(0);
    expect(cueMixGains(1).master).toBeCloseTo(1);
    const { cue, master } = cueMixGains(0.5);
    expect(cue * cue + master * master).toBeCloseTo(1);
  });
});

describe('echoTimeFor', () => {
  it('3/4 拍の長さにする', () => {
    expect(echoTimeFor(120)).toBeCloseTo(0.375);
    expect(echoTimeFor(128)).toBeCloseTo(0.3515625);
  });

  it('BPM が分からなければ既定値', () => {
    expect(echoTimeFor(null)).toBe(0.375);
    expect(echoTimeFor(0)).toBe(0.375);
    expect(echoTimeFor(NaN)).toBe(0.375);
  });

  it('極端なテンポでも、遅延を一定の範囲に収める', () => {
    expect(echoTimeFor(1000)).toBe(0.1);
    expect(echoTimeFor(10)).toBe(1.5);
  });
});
