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
