/** 拍の位置を firstBeat と bpm だけで表すビートグリッド。すべて曲の中の時刻（秒）で扱う。 */

export function beatSeconds(bpm: number): number {
  return 60 / bpm;
}

/** 拍の中での位置（0 以上 1 未満）。拍の頭で 0。 */
export function beatPhase(time: number, firstBeat: number, bpm: number): number {
  const beats = ((time - firstBeat) * bpm) / 60;
  return beats - Math.floor(beats);
}

/** time にいちばん近い拍の時刻。 */
export function nearestBeat(time: number, firstBeat: number, bpm: number): number {
  const index = Math.round(((time - firstBeat) * bpm) / 60);
  return firstBeat + (index * 60) / bpm;
}

/** from 以上 to 以下にある拍の時刻。 */
export function beatTimesIn(firstBeat: number, bpm: number, from: number, to: number): number[] {
  const length = 60 / bpm;
  const times: number[] = [];
  for (let n = Math.ceil((from - firstBeat) / length); firstBeat + n * length <= to; n++) {
    times.push(firstBeat + n * length);
  }
  return times;
}

/**
 * 自分の拍の位相を相手に合わせるために、自分の位置を何秒ずらせばよいか。
 * 近いほうへ動かすので、結果は -半拍〜+半拍 に収まる。
 */
export function phaseCorrection(
  position: number,
  firstBeat: number,
  bpm: number,
  otherPosition: number,
  otherFirstBeat: number,
  otherBpm: number,
): number {
  let delta = beatPhase(otherPosition, otherFirstBeat, otherBpm) - beatPhase(position, firstBeat, bpm);
  if (delta > 0.5) delta -= 1;
  if (delta <= -0.5) delta += 1;
  return (delta * 60) / bpm;
}

export interface BeatLoopRegion {
  start: number;
  end: number;
}

/**
 * 再生位置を含むビートループの範囲。
 * 始点は拍（1 拍未満のループはそのループ長）の区切りに揃え、終点は始点から beats 拍先にする。
 * 位置を含むように前側へ丸めるので、ループを入れた瞬間に位置が跳ばない。
 */
export function beatLoopRegion(
  position: number,
  firstBeat: number,
  bpm: number,
  beats: number,
): BeatLoopRegion {
  const length = 60 / bpm;
  const step = Math.min(1, beats) * length;
  let start = firstBeat + Math.floor((position - firstBeat) / step) * step;
  // グリッドより前の位置（イントロなど）では、曲頭から始める。
  if (start < 0) start = 0;
  return { start, end: start + beats * length };
}

/** firstBeat は 0 以上 1 拍未満に収める。グリッドは周期的なので、どの拍を頭にしても同じ。 */
export function normalizeFirstBeat(position: number, bpm: number): number {
  const length = 60 / bpm;
  return ((position % length) + length) % length;
}

/** タップの間隔がこの範囲（30〜240 BPM）を外れたら、別のテンポで叩き直したとみなす。 */
const TAP_MIN_INTERVAL_MS = 250;
const TAP_MAX_INTERVAL_MS = 2000;
const TAP_WINDOW = 8;

/**
 * タップした時刻（ミリ秒）の列から BPM を求める。
 * 間隔の中央値を使うので、数回のタップのずれに引きずられにくい。
 * 間隔が 2 つ未満なら null。長く空いたタップは、そこから叩き直したものとして捨てる。
 */
export function tapBpm(timestamps: number[]): number | null {
  const recent: number[] = [];
  for (let i = timestamps.length - 1; i >= 0 && recent.length < TAP_WINDOW; i--) {
    const t = timestamps[i]!;
    const next = recent[0];
    if (next !== undefined && next - t > TAP_MAX_INTERVAL_MS) break;
    recent.unshift(t);
  }
  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const interval = recent[i]! - recent[i - 1]!;
    if (interval >= TAP_MIN_INTERVAL_MS) intervals.push(interval);
  }
  if (intervals.length < 2) return null;
  intervals.sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  const median = intervals.length % 2 ? intervals[mid]! : (intervals[mid - 1]! + intervals[mid]!) / 2;
  return 60000 / median;
}
