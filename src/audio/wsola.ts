export interface WsolaOptions {
  /** 1 フレームのサンプル数。合成ホップはこの半分。 */
  frameSize?: number;
  /** 波形の似ている位置を探す範囲（サンプル）。±この値。 */
  searchRadius?: number;
}

export interface LoopSamples {
  start: number;
  end: number;
}

/** 粗い探索で間引くサンプル数。 */
const DECIMATION = 4;

/**
 * WSOLA（Waveform Similarity Overlap-Add）による時間伸縮。
 * 再生レートを変えても音程を変えない（キーロック）ために使う。
 *
 * 入力を一定の間隔で窓掛けして切り出し、重ねて足し合わせる。
 * 切り出す位置は、直前のフレームの「自然な続き」に波形がいちばん似る位置へ少しずらす。
 * これで継ぎ目の位相が揃い、レートを変えても音が濁りにくい。
 *
 * DOM と Web Audio に依存しない。AudioWorklet から render() を 128 サンプルずつ呼ぶ。
 */
export class Wsola {
  /** 入力を 1 出力サンプルあたり何サンプル進めるか。1.1 なら 10% 速い。 */
  rate = 1;

  private readonly frame: number;
  private readonly hop: number;
  private readonly radius: number;
  private readonly searchLength: number;
  private readonly window: Float32Array;

  private channels: Float32Array[] = [];
  private mono = new Float32Array(0);
  private monoDecimated = new Float32Array(0);
  private loop: LoopSamples | null = null;

  private accum: Float32Array[] = [];
  private fifo: Float32Array[] = [];
  private readonly fifoCapacity: number;
  private fifoRead = 0;
  private fifoCount = 0;

  private nominal = 0;
  private target = 0;
  private first = true;
  private exhausted = true;
  private outPosition = 0;

  constructor(options: WsolaOptions = {}) {
    this.frame = options.frameSize ?? 2048;
    this.hop = this.frame / 2;
    this.radius = options.searchRadius ?? 512;
    this.searchLength = this.hop / 2;
    this.window = new Float32Array(this.frame);
    for (let i = 0; i < this.frame; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frame);
    }
    this.fifoCapacity = this.hop * 4 + 256;
  }

  /** 次に出力するサンプルに対応する、入力上の位置（サンプル）。 */
  get position(): number {
    return this.outPosition;
  }

  /** 入力の終わりまで出し切ったか。 */
  get ended(): boolean {
    return this.exhausted && this.fifoCount === 0;
  }

  setInput(channels: Float32Array[]): void {
    this.channels = channels;
    const length = channels[0]?.length ?? 0;
    this.mono = new Float32Array(length);
    for (const data of channels) {
      for (let i = 0; i < length; i++) this.mono[i]! += data[i]! / channels.length;
    }
    const decimatedLength = Math.floor(length / DECIMATION);
    this.monoDecimated = new Float32Array(decimatedLength);
    for (let j = 0; j < decimatedLength; j++) {
      let sum = 0;
      for (let k = 0; k < DECIMATION; k++) sum += this.mono[j * DECIMATION + k]!;
      this.monoDecimated[j] = sum / DECIMATION;
    }
    this.accum = channels.map(() => new Float32Array(this.frame));
    this.fifo = channels.map(() => new Float32Array(this.fifoCapacity));
    this.exhausted = true;
  }

  clearInput(): void {
    this.setInput([]);
  }

  /** position（サンプル）から再生を始める。 */
  start(position: number): void {
    for (const buffer of this.accum) buffer.fill(0);
    this.fifoRead = 0;
    this.fifoCount = 0;
    this.nominal = position;
    this.outPosition = position;
    this.target = 0;
    this.first = true;
    this.exhausted = this.channels.length === 0;
  }

  setLoop(loop: LoopSamples | null): void {
    this.loop = loop && loop.end > loop.start ? { start: Math.round(loop.start), end: Math.round(loop.end) } : null;
    if (this.loop && this.nominal >= this.loop.end) {
      const length = this.loop.end - this.loop.start;
      this.nominal = this.loop.start + ((this.nominal - this.loop.start) % length);
    }
  }

  /**
   * output の各チャンネルに frames サンプルを書く。入力が尽きたら残りは 0。
   * output のチャンネル数が入力より多いときは、最後の入力チャンネルを複製する。
   */
  render(output: Float32Array[], frames: number): void {
    const inputChannels = this.channels.length;
    if (inputChannels === 0) {
      for (const channel of output) channel.fill(0, 0, frames);
      return;
    }
    while (this.fifoCount < frames && !this.exhausted) this.generateFrame();

    const available = Math.min(frames, this.fifoCount);
    for (let c = 0; c < output.length; c++) {
      const out = output[c]!;
      const source = this.fifo[Math.min(c, inputChannels - 1)]!;
      for (let i = 0; i < available; i++) {
        out[i] = source[(this.fifoRead + i) % this.fifoCapacity]!;
      }
      out.fill(0, available, frames);
    }
    this.fifoRead = (this.fifoRead + available) % this.fifoCapacity;
    this.fifoCount -= available;
    this.advanceOutPosition(available);
  }

  private advanceOutPosition(samples: number): void {
    this.outPosition += samples * this.rate;
    const loop = this.loop;
    if (loop && this.outPosition >= loop.end) {
      const length = loop.end - loop.start;
      this.outPosition = loop.start + ((this.outPosition - loop.start) % length);
    }
  }

  private generateFrame(): void {
    const N = this.frame;
    const Hs = this.hop;
    const start = this.first ? Math.round(this.nominal) : this.bestStart(Math.round(this.nominal));

    for (let c = 0; c < this.channels.length; c++) {
      const data = this.channels[c]!;
      const acc = this.accum[c]!;
      for (let i = 0; i < N; i++) {
        // 最初のフレームの前半は、フェードインさせず入力をそのまま出す。
        const w = this.first && i < Hs ? 1 : this.window[i]!;
        acc[i]! += this.sample(data, start + i) * w;
      }
      const fifo = this.fifo[c]!;
      const write = (this.fifoRead + this.fifoCount) % this.fifoCapacity;
      for (let i = 0; i < Hs; i++) fifo[(write + i) % this.fifoCapacity] = acc[i]!;
      acc.copyWithin(0, Hs, N);
      acc.fill(0, N - Hs, N);
    }
    this.fifoCount += Hs;

    this.target = start + Hs;
    this.nominal += Hs * this.rate;
    const loop = this.loop;
    if (loop) {
      if (this.nominal >= loop.end) {
        const length = loop.end - loop.start;
        this.nominal = loop.start + ((this.nominal - loop.start) % length);
      }
    } else if (this.nominal >= this.mono.length) {
      this.exhausted = true;
    }
    this.first = false;
  }

  /** center の近くで、直前のフレームの続きに波形がいちばん似る開始位置。 */
  private bestStart(center: number): number {
    const dec = DECIMATION;
    const coarseLength = Math.floor(this.searchLength / dec);
    const targetCoarse = new Float32Array(coarseLength);
    const targetBase = Math.round(this.target / dec);
    for (let k = 0; k < coarseLength; k++) targetCoarse[k] = this.coarse(targetBase + k);

    let targetEnergy = 0;
    for (let k = 0; k < coarseLength; k++) targetEnergy += targetCoarse[k]! * targetCoarse[k]!;
    if (targetEnergy < 1e-12) return center;

    // 粗い探索: 間引いた信号で全範囲を見る。
    let bestOffset = 0;
    let bestScore = -Infinity;
    for (let d = -this.radius; d <= this.radius; d += dec) {
      const base = Math.round((center + d) / dec);
      let dot = 0;
      let energy = 0;
      for (let k = 0; k < coarseLength; k++) {
        const v = this.coarse(base + k);
        dot += v * targetCoarse[k]!;
        energy += v * v;
      }
      const score = this.score(dot, energy, targetEnergy, d);
      if (score > bestScore) {
        bestScore = score;
        bestOffset = d;
      }
    }

    // 細かい探索: 粗い結果の周りだけ、元のサンプルで詰める。
    const targetFine = new Float32Array(this.searchLength);
    for (let k = 0; k < this.searchLength; k++) targetFine[k] = this.sample(this.mono, this.target + k);
    let fineEnergy = 0;
    for (let k = 0; k < this.searchLength; k++) fineEnergy += targetFine[k]! * targetFine[k]!;

    let refined = bestOffset;
    let refinedScore = -Infinity;
    for (let d = bestOffset - dec; d <= bestOffset + dec; d++) {
      if (d < -this.radius || d > this.radius) continue;
      let dot = 0;
      let energy = 0;
      for (let k = 0; k < this.searchLength; k++) {
        const v = this.sample(this.mono, center + d + k);
        dot += v * targetFine[k]!;
        energy += v * v;
      }
      const score = this.score(dot, energy, fineEnergy, d);
      if (score > refinedScore) {
        refinedScore = score;
        refined = d;
      }
    }
    return center + refined;
  }

  /** 正規化した相関。ずれが小さいほうをわずかに優先して、同点なら動かさない。 */
  private score(dot: number, energy: number, targetEnergy: number, offset: number): number {
    const normalized = dot / Math.sqrt(energy * targetEnergy + 1e-12);
    return normalized - (1e-4 * Math.abs(offset)) / this.radius;
  }

  private coarse(index: number): number {
    const loop = this.loop;
    let full = index * DECIMATION;
    if (loop && full >= loop.end) full = loop.start + ((full - loop.start) % (loop.end - loop.start));
    const j = Math.floor(full / DECIMATION);
    return j >= 0 && j < this.monoDecimated.length ? this.monoDecimated[j]! : 0;
  }

  private sample(data: Float32Array, index: number): number {
    const loop = this.loop;
    let i = index;
    if (loop && i >= loop.end) i = loop.start + ((i - loop.start) % (loop.end - loop.start));
    return i >= 0 && i < data.length ? data[i]! : 0;
  }
}
