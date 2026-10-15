import { describe, expect, it } from 'vitest';
import { renderDemoTrack } from './demo';

const options = { bpm: 120, bars: 2, bass: [55], leadIn: 0.25 };

describe('renderDemoTrack', () => {
  it('曲の長さが拍数と曲頭の無音に見合う', () => {
    const [left, right] = renderDemoTrack(8000, options);
    expect(left.length).toBe(right.length);
    const expected = (0.25 + 2 * 4 * 0.5 + 0.5) * 8000;
    expect(left.length).toBe(Math.ceil(expected));
  });

  it('クリップせず、最大振幅が 0.9 に正規化される', () => {
    const [left, right] = renderDemoTrack(8000, options);
    const peak = Math.max(...left.map(Math.abs), ...right.map(Math.abs));
    expect(peak).toBeCloseTo(0.9, 5);
  });

  it('曲頭の無音の間は音が鳴らない', () => {
    const [left] = renderDemoTrack(8000, options);
    for (let i = 0; i < 0.24 * 8000; i++) expect(left[i]).toBe(0);
  });

  it('同じ条件なら同じ波形になる', () => {
    const a = renderDemoTrack(8000, options)[0];
    const b = renderDemoTrack(8000, options)[0];
    expect(a).toEqual(b);
  });
});
