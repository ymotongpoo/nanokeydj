export interface BpmResult {
  bpm: number;
  /** 最初の拍の位置（秒）。0 以上で 1 拍より短い。 */
  firstBeat: number;
  /** 最良の候補が他の候補より突出している度合い。1 に近いほど当てにならない。 */
  confidence: number;
}

export interface BpmOptions {
  minBpm?: number;
  maxBpm?: number;
  /** 解析に使う長さ（秒）。長い曲は中央付近を使う。 */
  maxSeconds?: number;
}

const ONSET_RATE = 200;
const LOW_BAND_HZ = 150;
/** 4 つ打ちのダンス音楽の標準的なテンポ。半分や倍の候補で迷ったときの事前分布に使う。 */
const PREFERRED_BPM = 125;
const PREFERRED_SPREAD_OCTAVES = 0.6;

/**
 * モノラルのサンプル列から BPM と最初の拍を求める。
 * 低音域と全帯域のエネルギーの立ち上がりをオンセットとして取り出し、
 * テンポと位相の候補ごとに、拍の位置に並んだオンセットの平均を比べる。
 * 無音や短すぎる音源では null を返す。
 */
export function detectBpm(
  samples: Float32Array,
  sampleRate: number,
  options: BpmOptions = {},
): BpmResult | null {
  const minBpm = options.minBpm ?? 70;
  const maxBpm = options.maxBpm ?? 190;
  const maxSeconds = options.maxSeconds ?? 120;

  const duration = samples.length / sampleRate;
  if (duration < 8) return null;

  const windowStart = duration > maxSeconds ? ((duration - maxSeconds) / 2) : 0;
  const startSample = Math.floor(windowStart * sampleRate);
  const endSample = Math.min(samples.length, startSample + Math.floor(maxSeconds * sampleRate));

  const envelope = onsetEnvelope(samples, sampleRate, startSample, endSample);
  if (!envelope) return null;
  const { onset, frameRate } = envelope;

  let best = { bpm: 0, phase: 0, score: -Infinity, weighted: -Infinity };
  let scoreSum = 0;
  let candidates = 0;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const period = (frameRate * 60) / bpm;
    let phaseBest = { phase: 0, score: -Infinity };
    for (let phase = 0; phase < period; phase += 1) {
      const score = combScore(onset, phase, period);
      if (score > phaseBest.score) phaseBest = { phase, score };
    }
    const weighted = phaseBest.score * tempoPrior(bpm);
    scoreSum += phaseBest.score;
    candidates++;
    if (weighted > best.weighted) best = { bpm, phase: phaseBest.phase, score: phaseBest.score, weighted };
  }
  if (!(best.score > 0)) return null;

  // 粗い結果の周辺を細かく探して、テンポと位相を詰める。
  let refined = { bpm: best.bpm, phase: best.phase, score: -Infinity };
  for (let bpm = best.bpm - 0.3; bpm <= best.bpm + 0.3 + 1e-9; bpm += 0.01) {
    const period = (frameRate * 60) / bpm;
    for (let phase = best.phase - 2; phase <= best.phase + 2 + 1e-9; phase += 0.25) {
      const p = ((phase % period) + period) % period;
      const score = combScore(onset, p, period);
      if (score > refined.score) refined = { bpm, phase: p, score };
    }
  }

  const beatSeconds = 60 / refined.bpm;
  const firstBeatInWindow = windowStart + refined.phase / frameRate;
  const firstBeat = ((firstBeatInWindow % beatSeconds) + beatSeconds) % beatSeconds;
  const meanScore = scoreSum / candidates;
  return {
    bpm: refined.bpm,
    firstBeat,
    confidence: meanScore > 0 ? refined.score / meanScore : 0,
  };
}

function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / PREFERRED_BPM) / PREFERRED_SPREAD_OCTAVES;
  return Math.exp(-0.5 * octaves * octaves);
}

/** period 間隔で phase から並べた点のオンセットの平均。点の間は線形補間する。 */
function combScore(onset: Float64Array, phase: number, period: number): number {
  let sum = 0;
  let count = 0;
  for (let position = phase; position < onset.length - 1; position += period) {
    const i = Math.floor(position);
    const frac = position - i;
    sum += onset[i]! * (1 - frac) + onset[i + 1]! * frac;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/** 低音域と全帯域のエネルギーの立ち上がりを合成し、局所平均を引いて山だけを残した曲線。 */
function onsetEnvelope(
  samples: Float32Array,
  sampleRate: number,
  start: number,
  end: number,
): { onset: Float64Array; frameRate: number } | null {
  const hop = Math.max(1, Math.round(sampleRate / ONSET_RATE));
  const frameRate = sampleRate / hop;
  const frames = Math.floor((end - start) / hop);
  if (frames < 100) return null;

  const low = new Float64Array(frames);
  const full = new Float64Array(frames);
  const alpha = 1 - Math.exp((-2 * Math.PI * LOW_BAND_HZ) / sampleRate);
  let y1 = 0;
  let y2 = 0;
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let lowSum = 0;
    let fullSum = 0;
    const base = start + f * hop;
    for (let i = 0; i < hop; i++) {
      const x = samples[base + i]!;
      y1 += alpha * (x - y1);
      y2 += alpha * (y1 - y2);
      lowSum += y2 * y2;
      fullSum += x * x;
    }
    low[f] = Math.sqrt(lowSum / hop);
    full[f] = Math.sqrt(fullSum / hop);
    peak = Math.max(peak, full[f]!);
  }
  if (peak < 1e-4) return null;

  const lowFlux = normalizedFlux(low);
  const fullFlux = normalizedFlux(full);
  const combined = new Float64Array(frames);
  for (let f = 0; f < frames; f++) combined[f] = lowFlux[f]! + 0.5 * fullFlux[f]!;

  return { onset: subtractLocalMean(combined, Math.round(frameRate * 0.4)), frameRate };
}

/** エネルギー曲線の増加分だけを取り出し、平均が 1 になるよう正規化する。 */
function normalizedFlux(energy: Float64Array): Float64Array {
  const flux = new Float64Array(energy.length);
  let total = 0;
  for (let i = 1; i < energy.length; i++) {
    const rise = energy[i]! - energy[i - 1]!;
    flux[i] = rise > 0 ? rise : 0;
    total += flux[i]!;
  }
  const mean = total / energy.length;
  if (mean > 0) for (let i = 0; i < flux.length; i++) flux[i]! /= mean;
  return flux;
}

function subtractLocalMean(values: Float64Array, radius: number): Float64Array {
  const prefix = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i]! + values[i]!;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - radius);
    const to = Math.min(values.length, i + radius + 1);
    const mean = (prefix[to]! - prefix[from]!) / (to - from);
    out[i] = Math.max(0, values[i]! - mean);
  }
  return out;
}
