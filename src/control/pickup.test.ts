import { describe, expect, it } from 'vitest';
import { Pickup } from './pickup';

describe('Pickup', () => {
  it('実機の値が画面の値から遠いうちは反映しない', () => {
    const pickup = new Pickup();
    expect(pickup.accept('f1', 0.1, 0.8)).toBe(false);
    expect(pickup.accept('f1', 0.3, 0.8)).toBe(false);
    expect(pickup.accept('f1', 0.5, 0.8)).toBe(false);
  });

  it('画面の値に近づいたところから反映する', () => {
    const pickup = new Pickup();
    pickup.accept('f1', 0.5, 0.8);
    expect(pickup.accept('f1', 0.79, 0.8)).toBe(true);
    expect(pickup.accept('f1', 0.9, 0.8)).toBe(true);
  });

  it('近づく前に画面の値をまたいだら、またいだ値から反映する', () => {
    const pickup = new Pickup();
    expect(pickup.accept('f1', 0.5, 0.8)).toBe(false);
    expect(pickup.accept('f1', 0.95, 0.8)).toBe(true);
  });

  it('最初の値が画面の値に近ければ、すぐ反映する', () => {
    const pickup = new Pickup();
    expect(pickup.accept('f1', 0.81, 0.8)).toBe(true);
  });

  it('反映中に画面側が別の経路で動かされたら、もう一度ピックアップを待つ', () => {
    const pickup = new Pickup();
    pickup.accept('f1', 0.8, 0.8);
    expect(pickup.accept('f1', 0.82, 0.8)).toBe(true);
    // 画面のスライダーで 0.2 に動かされた。実機は 0.82 付近にある。
    expect(pickup.accept('f1', 0.84, 0.2)).toBe(false);
    expect(pickup.accept('f1', 0.5, 0.2)).toBe(false);
    expect(pickup.accept('f1', 0.21, 0.2)).toBe(true);
  });

  it('入力元ごとに独立して状態を持つ', () => {
    const pickup = new Pickup();
    expect(pickup.accept('f1', 0.1, 0.8)).toBe(false);
    expect(pickup.accept('f2', 0.8, 0.8)).toBe(true);
    expect(pickup.accept('f1', 0.1, 0.8)).toBe(false);
  });

  it('待機中の入力元の数を数える', () => {
    const pickup = new Pickup();
    pickup.accept('f1', 0.1, 0.8);
    pickup.accept('f2', 0.8, 0.8);
    expect(pickup.waiting).toBe(1);
    pickup.reset();
    expect(pickup.waiting).toBe(0);
  });
});
