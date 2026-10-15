/** 実機の値が画面の値に「追いついた」とみなす幅。7bit の 1 目盛りの 4 倍弱。 */
export const PICKUP_THRESHOLD = 0.03;

interface PickupState {
  engaged: boolean;
  /** 直前に届いた実機の値。 */
  last: number | null;
  /** 最後に反映した値。画面側の値がこれと違えば、別の経路で動かされたと分かる。 */
  applied: number | null;
}

/**
 * ピックアップ（テイクオーバー）。
 * 絶対値を送る実機のフェーダーやノブは、起動直後や画面側で値が変わったあと、
 * 実機の位置と画面の値がずれている。そのまま反映すると音が跳ぶので、
 * 実機の値が画面の値に近づくか、画面の値をまたぐまでは反映しない。
 */
export class Pickup {
  private states = new Map<string, PickupState>();

  /** physical は実機の値、software は画面側（レジストリ）の現在値。反映してよければ true。 */
  accept(key: string, physical: number, software: number): boolean {
    const state = this.states.get(key) ?? { engaged: false, last: null, applied: null };
    this.states.set(key, state);

    if (state.engaged && state.applied !== null && Math.abs(software - state.applied) > 1e-6) {
      // 画面のスライダーなど、実機以外で値が動いた。もう一度ピックアップを待つ。
      state.engaged = false;
    }

    if (!state.engaged) {
      const close = Math.abs(physical - software) <= PICKUP_THRESHOLD;
      const crossed = state.last !== null && (state.last - software) * (physical - software) <= 0;
      if (close || crossed) state.engaged = true;
    }

    state.last = physical;
    if (!state.engaged) return false;
    state.applied = physical;
    return true;
  }

  /** 実機の値が画面の値に追いついていない（反映を待っている）入力元の数。 */
  get waiting(): number {
    let count = 0;
    for (const state of this.states.values()) if (!state.engaged) count++;
    return count;
  }

  reset(): void {
    this.states.clear();
  }
}
