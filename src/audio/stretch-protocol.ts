/** メインスレッドからワークレットへ送る指示。時刻と位置の単位は秒。 */
export type StretchMessage =
  | { type: 'load'; channels: Float32Array[] }
  | { type: 'unload' }
  | {
      type: 'play';
      /** この AudioContext 時刻から offset の位置で鳴り始めたことにする。 */
      when: number;
      offset: number;
      rate: number;
      loop: { start: number; end: number } | null;
    }
  | { type: 'stop' }
  | { type: 'rate'; rate: number }
  | { type: 'loop'; loop: { start: number; end: number } | null };

/** ワークレットからメインスレッドへ返す通知。 */
export type StretchEvent = { type: 'ended' };
