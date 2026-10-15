import type { DeckId, EqBand } from '../control/controls';
import {
  crossfaderGains,
  cueMixGains,
  eqGainDb,
  filterCutoffs,
  volumeGain,
  type CrossfaderCurve,
} from './curves';

/** 値の変化で耳障りなクリックが出ないよう、パラメーターは短い時定数でなめらかに追従させる。 */
const SMOOTHING = 0.015;

function setSmooth(ctx: BaseAudioContext, param: AudioParam, value: number): void {
  param.setTargetAtTime(value, ctx.currentTime, SMOOTHING);
}

/** エコーの最大の遅延（秒）と、繰り返しの減衰。 */
const ECHO_MAX_DELAY = 2;
const ECHO_FEEDBACK = 0.5;

const EQ_FREQ: Record<EqBand, number> = { low: 200, mid: 1000, high: 3500 };

/**
 * ヘッドホンの出し方。
 * off: マスターだけをステレオで出す。
 * split: 左にマスター、右にヘッドホンのモノラルを出す（スプリッターケーブルで分ける）。
 * quad: 4ch で、1-2 にマスター、3-4 にヘッドホンを出す（4ch 以上のオーディオインターフェース用）。
 */
export type CueRouting = 'off' | 'split' | 'quad';

/** 1 チャンネル分のストリップ: トリム → EQ → フィルター → チャンネルフェーダー → クロスフェーダー。 */
export class ChannelStrip {
  readonly input: GainNode;
  readonly output: GainNode;
  /** ヘッドホンへの送り。EQ とフィルターの後、フェーダーの前から取る（PFL）。 */
  readonly cueSend: GainNode;
  private eq: Record<EqBand, BiquadFilterNode>;
  private lowpass: BiquadFilterNode;
  private highpass: BiquadFilterNode;
  private fader: GainNode;
  private analyser: AnalyserNode;
  private samples: Float32Array<ArrayBuffer>;
  private _cue = false;

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
    this.cueSend = ctx.createGain();
    this.cueSend.gain.value = 0;
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
    this.highpass.connect(this.cueSend);
    this.fader.connect(this.analyser);
  }

  get cue(): boolean {
    return this._cue;
  }

  setCue(enabled: boolean): void {
    this._cue = enabled;
    setSmooth(this.ctx, this.cueSend.gain, enabled ? 1 : 0);
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

/** 2 チャンネルのミキサー。クロスフェーダー、マスター、ヘッドホン Cue を持つ。 */
export class Mixer {
  readonly channels: Record<DeckId, ChannelStrip>;
  readonly master: GainNode;
  /** マスターの最終出力。出し方（routing）に応じてここから先をつなぎ替える。 */
  private masterOut: GainNode;
  private limiter: DynamicsCompressorNode;
  private masterAnalyser: AnalyserNode;
  private masterSamples: Float32Array<ArrayBuffer>;

  /** マスターエフェクト: X のフィルターと、Y で送るエコー。 */
  private fxHighpass: BiquadFilterNode;
  private fxLowpass: BiquadFilterNode;
  private echoSend: GainNode;
  private echoDelay: DelayNode;

  private headphoneCue: GainNode;
  private headphoneMaster: GainNode;
  private headphoneVolume: GainNode;
  private headphoneOut: GainNode;
  private routingNodes: AudioNode[] = [];
  /**
   * 出力デバイスが扱えるチャンネル数。destination のチャンネル数を変えると
   * maxChannelCount まで変わる実装があるので、触る前に控えておく。
   */
  private readonly maxChannels: number;
  private destinationIsQuad = false;
  private recordDestination: MediaStreamAudioDestinationNode | null = null;

  private crossfader = 0.5;
  private curve: CrossfaderCurve = 'smooth';
  private _routing: CueRouting = 'off';

  constructor(private ctx: BaseAudioContext) {
    this.maxChannels = ctx.destination.maxChannelCount;
    this.channels = { A: new ChannelStrip(ctx), B: new ChannelStrip(ctx) };
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.masterOut = ctx.createGain();
    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 512;
    this.masterSamples = new Float32Array(this.masterAnalyser.fftSize);

    this.channels.A.output.connect(this.master);
    this.channels.B.output.connect(this.master);
    // マスターエフェクト。素通しのとき（フィルター中央、エコー 0）は音を変えない。
    this.fxHighpass = ctx.createBiquadFilter();
    this.fxHighpass.type = 'highpass';
    this.fxHighpass.frequency.value = 20;
    this.fxHighpass.Q.value = 1.2;
    this.fxLowpass = ctx.createBiquadFilter();
    this.fxLowpass.type = 'lowpass';
    this.fxLowpass.frequency.value = 20000;
    this.fxLowpass.Q.value = 1.2;
    const fxSum = ctx.createGain();
    this.master.connect(this.fxHighpass).connect(this.fxLowpass).connect(fxSum);

    // エコー: 遅延の出力を高域を削ってから戻し、繰り返すたびに丸く減衰させる。
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0;
    this.echoDelay = ctx.createDelay(ECHO_MAX_DELAY);
    this.echoDelay.delayTime.value = 0.375;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 4000;
    const echoFeedback = ctx.createGain();
    echoFeedback.gain.value = ECHO_FEEDBACK;
    this.master.connect(this.echoSend).connect(this.echoDelay).connect(echoTone);
    echoTone.connect(echoFeedback).connect(this.echoDelay);
    echoTone.connect(fxSum);

    fxSum.connect(this.limiter).connect(this.masterOut);
    this.limiter.connect(this.masterAnalyser);

    // ヘッドホン: Cue した信号とマスターを混ぜ、音量をかける。
    this.headphoneCue = ctx.createGain();
    this.headphoneMaster = ctx.createGain();
    this.headphoneVolume = ctx.createGain();
    this.headphoneOut = ctx.createGain();
    this.channels.A.cueSend.connect(this.headphoneCue);
    this.channels.B.cueSend.connect(this.headphoneCue);
    this.headphoneCue.connect(this.headphoneVolume);
    this.limiter.connect(this.headphoneMaster).connect(this.headphoneVolume);
    this.headphoneVolume.connect(this.headphoneOut);

    this.applyCrossfader();
    this.setHeadphoneMix(0.5);
    this.setHeadphoneVolume(0.7);
    this.applyRouting();
  }

  get routing(): CueRouting {
    return this._routing;
  }

  /** 4ch 出力に使えるか。出力デバイスが 4ch 以上に対応しているときだけ true。 */
  get quadAvailable(): boolean {
    return this.maxChannels >= 4;
  }

  setRouting(routing: CueRouting): void {
    if (routing === 'quad' && !this.quadAvailable) routing = 'off';
    this._routing = routing;
    this.applyRouting();
  }

  /**
   * マスター出力を録音するためのストリーム。初めて呼んだときにタップをつなぐ。
   * ヘッドホンの Cue は含まない。
   */
  get recordingStream(): MediaStream {
    if (!this.recordDestination) {
      if (!('createMediaStreamDestination' in this.ctx)) {
        throw new Error('このコンテキストは録音に対応していません');
      }
      this.recordDestination = (this.ctx as AudioContext).createMediaStreamDestination();
      this.masterOut.connect(this.recordDestination);
    }
    return this.recordDestination.stream;
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

  setHeadphoneVolume(value: number): void {
    setSmooth(this.ctx, this.headphoneVolume.gain, volumeGain(value));
  }

  /** 0 で Cue だけ、1 でマスターだけ。 */
  setHeadphoneMix(value: number): void {
    const { cue, master } = cueMixGains(value);
    setSmooth(this.ctx, this.headphoneCue.gain, cue);
    setSmooth(this.ctx, this.headphoneMaster.gain, master);
  }

  /**
   * マスターエフェクト。x はフィルター（0.5 が素通し、左へローパス、右へハイパス）、
   * y はエコーの量（0 で送らない）。すでに出たエコーは自然に減衰する。
   */
  setFx(x: number, y: number): void {
    const { lowpassHz, highpassHz } = filterCutoffs(x);
    setSmooth(this.ctx, this.fxLowpass.frequency, lowpassHz);
    setSmooth(this.ctx, this.fxHighpass.frequency, highpassHz);
    setSmooth(this.ctx, this.echoSend.gain, Math.min(1, Math.max(0, y)));
  }

  setEchoTime(seconds: number): void {
    setSmooth(this.ctx, this.echoDelay.delayTime, Math.min(ECHO_MAX_DELAY, Math.max(0.01, seconds)));
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

  /** 出し方に応じて、マスターとヘッドホンの出力先をつなぎ替える。 */
  private applyRouting(): void {
    this.masterOut.disconnect();
    // つなぎ替えで録音用のタップも外れるので、つなぎ直す。
    if (this.recordDestination) this.masterOut.connect(this.recordDestination);
    this.headphoneOut.disconnect();
    for (const node of this.routingNodes) node.disconnect();
    this.routingNodes = [];

    const destination = this.ctx.destination;
    this.setDestinationQuad(this._routing === 'quad');

    switch (this._routing) {
      case 'off':
        this.masterOut.connect(destination);
        break;
      case 'split': {
        // 左右をモノラルに畳み、マスターを左、ヘッドホンを右へ出す。
        const merger = this.ctx.createChannelMerger(2);
        const masterMono = this.monoNode();
        const headphoneMono = this.monoNode();
        this.masterOut.connect(masterMono).connect(merger, 0, 0);
        this.headphoneOut.connect(headphoneMono).connect(merger, 0, 1);
        merger.connect(destination);
        this.routingNodes.push(merger, masterMono, headphoneMono);
        break;
      }
      case 'quad': {
        const merger = this.ctx.createChannelMerger(4);
        const masterSplit = this.ctx.createChannelSplitter(2);
        const headphoneSplit = this.ctx.createChannelSplitter(2);
        this.masterOut.connect(masterSplit);
        this.headphoneOut.connect(headphoneSplit);
        masterSplit.connect(merger, 0, 0);
        masterSplit.connect(merger, 1, 1);
        headphoneSplit.connect(merger, 0, 2);
        headphoneSplit.connect(merger, 1, 3);
        merger.connect(destination);
        this.routingNodes.push(merger, masterSplit, headphoneSplit);
        break;
      }
    }
  }

  private monoNode(): GainNode {
    const node = this.ctx.createGain();
    node.channelCount = 1;
    node.channelCountMode = 'explicit';
    node.channelInterpretation = 'speakers';
    return node;
  }

  /** 4ch へ切り替えるとき、または 4ch から戻るときだけ、出力先のチャンネル数を変える。 */
  private setDestinationQuad(quad: boolean): void {
    if (quad === this.destinationIsQuad) return;
    const destination = this.ctx.destination;
    try {
      destination.channelCount = quad ? 4 : 2;
      destination.channelInterpretation = quad ? 'discrete' : 'speakers';
      this.destinationIsQuad = quad;
    } catch {
      // チャンネル数を変えられない出力先では、そのまま使う。
    }
  }
}
