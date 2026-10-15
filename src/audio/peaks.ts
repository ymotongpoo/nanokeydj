export interface Peaks {
  /** 各バケットの最小値と最大値。2 要素ずつ [min0, max0, min1, max1, ...] と並ぶ。 */
  data: Float32Array;
  buckets: number;
}

/** 波形の全体表示用に、サンプル列を一定数のバケットへ要約する。 */
export function computePeaks(samples: Float32Array, buckets: number): Peaks {
  const data = new Float32Array(buckets * 2);
  const size = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size);
    const end = Math.max(start + 1, Math.floor((b + 1) * size));
    let min = Infinity;
    let max = -Infinity;
    for (let i = start; i < end && i < samples.length; i++) {
      const v = samples[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    data[b * 2] = min === Infinity ? 0 : min;
    data[b * 2 + 1] = max === -Infinity ? 0 : max;
  }
  return { data, buckets };
}

/** 左右チャンネルを平均してモノラルにする。 */
export function mixToMono(buffer: AudioBuffer): Float32Array {
  const left = buffer.getChannelData(0);
  if (buffer.numberOfChannels < 2) return left;
  const right = buffer.getChannelData(1);
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (left[i]! + right[i]!) / 2;
  return mono;
}
