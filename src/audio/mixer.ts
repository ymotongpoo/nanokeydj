import type { DeckId, EqBand } from '../control/controls';
import { crossfaderGains, eqGainDb, filterCutoffs, volumeGain, type CrossfaderCurve } from './curves';

/** 値の変化で耳障りなクリックが出ないよう、パラメーターは短い時定数でなめらかに追従させる。 */
const SMOOTHING = 0.015;

function setSmooth(ctx: BaseAudioContext, param: AudioParam, value: number): void {
  param.setTargetAtTime(value, ctx.currentTime, SMOOTHING);
}

const EQ_FREQ: Record<EqBand, number> = { low: 200, mid: 1000, high: 3500 };

/** 1 チャンネル分のストリップ: トリム → EQ → フィルター → チャンネルフェーダー → クロスフェーダー。 */
export class ChannelStrip {
  readonly input: GainNode;
  readonly output: GainNode;
  private eq: Record<EqBand, BiquadFilterNode>;
  private lowpass: BiquadFilterNode;
  private highpass: BiquadFilterNode;
  private fader: GainNode;
  private analyser: AnalyserNode;
  private samples: Float32Array<ArrayBuffer>;

  constructor(private ctx: BaseAudioContext) {
    this.input = ctx.createGain();

    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = EQ_FREQ.low;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = EQ_FREQ.mid;
    mid.Q.value = 0.7;
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = EQ_FREQ.high;
    this.eq = { low, mid, high };

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;
    this.lowpass.Q.value = 0.7;
    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 20;
    this.highpass.Q.value = 0.7;

    this.fader = ctx.createGain();
    this.output = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.samples = new Float32Array(this.analyser.fftSize);

    this.input
      .connect(low)
      .connect(mid)
      .connect(high)
      .connect(this.lowpass)
      .connect(this.highpass)
      .connect(this.fader)
      .connect(this.output);
    this.fader.connect(this.analyser);
  }

  setVolume(value: number): void {
    setSmooth(this.ctx, this.fader.gain, volumeGain(value));
  }

  setEq(band: EqBand, value: number): void {
    setSmooth(this.ctx, this.eq[band].gain, eqGainDb(value));
  }

  setFilter(value: number): void {
    const { lowpassHz, highpassHz } = filterCutoffs(value);
    setSmooth(this.ctx, this.lowpass.frequency, lowpassHz);
    setSmooth(this.ctx, this.highpass.frequency, highpassHz);
  }

  setCrossGain(gain: number): void {
    setSmooth(this.ctx, this.output.gain, gain);
  }

  /** 直近のピーク（0〜1）。レベルメーター用。 */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (const sample of this.samples) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }
}

/** 2 チャンネルのミキサー。クロスフェーダーとマスターを持つ。 */
export class Mixer {
  readonly channels: Record<DeckId, ChannelStrip>;
  readonly master: GainNode;
  private limiter: DynamicsCompressorNode;
  private masterAnalyser: AnalyserNode;
  private masterSamples: Float32Array<ArrayBuffer>;
  private crossfader = 0.5;
  private curve: CrossfaderCurve = 'smooth';

  constructor(private ctx: BaseAudioContext) {
    this.channels = { A: new ChannelStrip(ctx), B: new ChannelStrip(ctx) };
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 512;
    this.masterSamples = new Float32Array(this.masterAnalyser.fftSize);

    this.channels.A.output.connect(this.master);
    this.channels.B.output.connect(this.master);
    this.master.connect(this.limiter).connect(ctx.destination);
    this.limiter.connect(this.masterAnalyser);
    this.applyCrossfader();
  }

  setMaster(value: number): void {
    setSmooth(this.ctx, this.master.gain, volumeGain(value));
  }

  setCrossfader(value: number): void {
    this.crossfader = value;
    this.applyCrossfader();
  }

  setCurve(curve: CrossfaderCurve): void {
    this.curve = curve;
    this.applyCrossfader();
  }

  masterLevel(): number {
    this.masterAnalyser.getFloatTimeDomainData(this.masterSamples);
    let peak = 0;
    for (const sample of this.masterSamples) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }

  private applyCrossfader(): void {
    const { a, b } = crossfaderGains(this.crossfader, this.curve);
    this.channels.A.setCrossGain(a);
    this.channels.B.setCrossGain(b);
  }
}
