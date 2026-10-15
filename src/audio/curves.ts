/** フェーダーやノブの 0〜1 の値を、音の物理量に変換する純粋関数群。 */

export const EQ_KILL_DB = -40;
export const EQ_BOOST_DB = 6;

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** EQ ノブ。中央（0.5）が 0 dB、左いっぱいでほぼ無音、右いっぱいで +6 dB。 */
export function eqGainDb(value: number): number {
  const v = clamp01(value);
  if (v < 0.5) return EQ_KILL_DB * (1 - v / 0.5);
  return EQ_BOOST_DB * ((v - 0.5) / 0.5);
}

/** チャンネルフェーダーとマスター。2 乗のテーパーで、下側を細かく動かせる。 */
export function volumeGain(value: number): number {
  const v = clamp01(value);
  return v * v;
}

const FILTER_NEUTRAL_LOWPASS_HZ = 20000;
const FILTER_NEUTRAL_HIGHPASS_HZ = 20;
const FILTER_MIN_LOWPASS_HZ = 200;
const FILTER_MAX_HIGHPASS_HZ = 4000;
const FILTER_DEAD_ZONE = 0.02;

/**
 * ワンノブのフィルター。中央が素通し、左へ回すとローパスが下がり、右へ回すとハイパスが上がる。
 * 7bit の MIDI では中央がちょうど 0.5 にならないので、中央付近は不感帯として素通しにする。
 */
export function filterCutoffs(value: number): { lowpassHz: number; highpassHz: number } {
  const offset = clamp01(value) - 0.5;
  const magnitude = Math.abs(offset);
  if (magnitude <= FILTER_DEAD_ZONE) {
    return { lowpassHz: FILTER_NEUTRAL_LOWPASS_HZ, highpassHz: FILTER_NEUTRAL_HIGHPASS_HZ };
  }
  const t = (magnitude - FILTER_DEAD_ZONE) / (0.5 - FILTER_DEAD_ZONE);
  if (offset < 0) {
    return {
      lowpassHz: FILTER_NEUTRAL_LOWPASS_HZ * (FILTER_MIN_LOWPASS_HZ / FILTER_NEUTRAL_LOWPASS_HZ) ** t,
      highpassHz: FILTER_NEUTRAL_HIGHPASS_HZ,
    };
  }
  return {
    lowpassHz: FILTER_NEUTRAL_LOWPASS_HZ,
    highpassHz: FILTER_NEUTRAL_HIGHPASS_HZ * (FILTER_MAX_HIGHPASS_HZ / FILTER_NEUTRAL_HIGHPASS_HZ) ** t,
  };
}

export type CrossfaderCurve = 'smooth' | 'sharp' | 'linear';

/** x は 0（Deck A いっぱい）〜1（Deck B いっぱい）。 */
export function crossfaderGains(position: number, curve: CrossfaderCurve): { a: number; b: number } {
  const x = clamp01(position);
  switch (curve) {
    case 'linear':
      return { a: 1 - x, b: x };
    case 'sharp':
      return { a: clamp01((1 - x) * 10), b: clamp01(x * 10) };
    case 'smooth':
      return { a: Math.cos((x * Math.PI) / 2), b: Math.sin((x * Math.PI) / 2) };
  }
}

/** ヘッドホンの Cue/Master つまみ。0 で Cue だけ、1 でマスターだけ。等パワーで混ぜる。 */
export function cueMixGains(mix: number): { cue: number; master: number } {
  const m = clamp01(mix);
  return { cue: Math.cos((m * Math.PI) / 2), master: Math.sin((m * Math.PI) / 2) };
}

/** BPM が分からないときのエコーの遅延（秒）。 */
const ECHO_DEFAULT_SECONDS = 0.375;
const ECHO_MIN_SECONDS = 0.1;
const ECHO_MAX_SECONDS = 1.5;

/** エコーの遅延。テンポに合わせて 3/4 拍にする。BPM が分からなければ既定値。 */
export function echoTimeFor(bpm: number | null): number {
  if (bpm === null || !(bpm > 0)) return ECHO_DEFAULT_SECONDS;
  return Math.min(ECHO_MAX_SECONDS, Math.max(ECHO_MIN_SECONDS, (60 / bpm) * 0.75));
}

const TEMPO_DEAD_ZONE = 0.02;

/**
 * テンポフェーダーの値を再生レートに変える。
 * invert が true のときは DJ 機器の慣習に合わせ、上（値が大きい側）で遅く、下で速くなる。
 * rangePercent は ±何 % まで動かすか。
 */
export function tempoRate(value: number, rangePercent: number, invert = true): number {
  const delta = (clamp01(value) - 0.5) * 2;
  if (Math.abs(delta) < TEMPO_DEAD_ZONE) return 1;
  const sign = invert ? -1 : 1;
  return 1 + (sign * delta * rangePercent) / 100;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
