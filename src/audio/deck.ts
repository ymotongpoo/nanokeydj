import type { DeckId } from '../control/controls';
import { Emitter } from '../util/emitter';
import { phaseCorrection } from './beatgrid';
import { PlaybackClock, type LoopRegion } from './clock';

/** nudge（一時的なテンポ微調整）の最大幅。±5 %。 */
const NUDGE_DEPTH = 0.05;

export interface DeckSnapshot {
  loaded: boolean;
  name: string;
  duration: number;
  position: number;
  playing: boolean;
  /** テンポフェーダーと nudge を合わせた再生レート。 */
  rate: number;
  tempoRate: number;
  loop: LoopRegion | null;
  bpm: number | null;
  firstBeat: number;
  analyzing: boolean;
}

/** 1 台のデッキ。バッファを再生し、位置とテンポとループを管理する。 */
export class Deck {
  /** 曲の読み込み、再生と停止、ループの変更など、画面を描き直すべき離散的な変化。 */
  readonly onChange = new Emitter<void>();
  readonly output: GainNode;

  private buffer: AudioBuffer | null = null;
  private clock: PlaybackClock | null = null;
  private source: AudioBufferSourceNode | null = null;
  private _name = '';
  private _tempoRate = 1;
  private nudge = 0;
  private _bpm: number | null = null;
  private _firstBeat = 0;
  private _analyzing = false;

  constructor(
    readonly id: DeckId,
    private ctx: AudioContext,
  ) {
    this.output = ctx.createGain();
  }

  get loaded(): boolean {
    return this.buffer !== null;
  }

  get name(): string {
    return this._name;
  }

  get audio(): AudioBuffer | null {
    return this.buffer;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get playing(): boolean {
    return this.clock?.isPlaying ?? false;
  }

  get rate(): number {
    return this._tempoRate * (1 + this.nudge * NUDGE_DEPTH);
  }

  get tempoRate(): number {
    return this._tempoRate;
  }

  /** 曲そのもののテンポ。再生レートは含まない。 */
  get bpm(): number | null {
    return this._bpm;
  }

  /** 最初の拍の位置（秒）。 */
  get firstBeat(): number {
    return this._firstBeat;
  }

  /** 再生レートを掛けた、いま聞こえているテンポ。 */
  get effectiveBpm(): number | null {
    return this._bpm === null ? null : this._bpm * this.rate;
  }

  get analyzing(): boolean {
    return this._analyzing;
  }

  get loop(): LoopRegion | null {
    return this.clock?.loop ?? null;
  }

  get position(): number {
    return this.clock?.positionAt(this.ctx.currentTime) ?? 0;
  }

  snapshot(): DeckSnapshot {
    return {
      loaded: this.loaded,
      name: this._name,
      duration: this.duration,
      position: this.position,
      playing: this.playing,
      rate: this.rate,
      tempoRate: this._tempoRate,
      loop: this.loop,
      bpm: this._bpm,
      firstBeat: this._firstBeat,
      analyzing: this._analyzing,
    };
  }

  load(buffer: AudioBuffer, name: string): void {
    this.stopSource();
    this.buffer = buffer;
    this._name = name;
    this.clock = new PlaybackClock(buffer.duration);
    this.clock.rate = this.rate;
    this._bpm = null;
    this._firstBeat = 0;
    this._analyzing = false;
    this.onChange.emit();
  }

  setAnalyzing(analyzing: boolean): void {
    this._analyzing = analyzing;
    this.onChange.emit();
  }

  setAnalysis(bpm: number, firstBeat: number): void {
    this._bpm = bpm;
    this._firstBeat = firstBeat;
    this.onChange.emit();
  }

  /** 解析が半分や倍のテンポを選んだときの手動の修正。グリッドの頭は変えない。 */
  setBpm(bpm: number): void {
    if (this._bpm === null) return;
    this._bpm = Math.min(300, Math.max(30, bpm));
    this.onChange.emit();
  }

  /**
   * 相手のデッキにテンポと拍の位相を合わせる。
   * 両方が再生中のときだけ、位相のずれを近いほうへ位置を動かして直す。
   */
  sync(other: Deck): void {
    const mine = this._bpm;
    const theirs = other.effectiveBpm;
    if (!this.clock || mine === null || theirs === null || other.bpm === null) return;
    this.setTempoRate(Math.min(1.5, Math.max(0.5, theirs / mine)));
    if (this.playing && other.playing) {
      const shift = phaseCorrection(
        this.position,
        this._firstBeat,
        mine,
        other.position,
        other.firstBeat,
        other.bpm,
      );
      this.seek(this.position + shift);
    }
  }

  play(): void {
    const clock = this.clock;
    if (!clock || clock.isPlaying) return;
    const now = this.ctx.currentTime;
    if (clock.positionAt(now) >= clock.duration) clock.seek(now, 0);
    clock.play(now);
    this.startSource();
    this.onChange.emit();
  }

  pause(): void {
    const clock = this.clock;
    if (!clock || !clock.isPlaying) return;
    clock.pause(this.ctx.currentTime);
    this.stopSource();
    this.onChange.emit();
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(position: number): void {
    const clock = this.clock;
    if (!clock) return;
    clock.seek(this.ctx.currentTime, position);
    if (clock.isPlaying) this.startSource();
    this.onChange.emit();
  }

  /** テンポフェーダー由来の再生レート。 */
  setTempoRate(rate: number): void {
    this._tempoRate = rate;
    this.applyRate();
  }

  /** -1〜1。ピッチベンドボタンなどで一時的にテンポを上げ下げする。 */
  setNudge(value: number): void {
    this.nudge = Math.min(1, Math.max(-1, value));
    this.applyRate();
  }

  setLoop(loop: LoopRegion | null): void {
    const clock = this.clock;
    if (!clock) return;
    const now = this.ctx.currentTime;
    const before = clock.positionAt(now);
    clock.setLoop(now, loop);
    const after = clock.positionAt(now);
    const source = this.source;
    if (source && Math.abs(after - before) < 1e-3) {
      // 位置が変わらないなら、再生中のノードのループ設定だけを差し替える（途切れない）。
      source.loop = loop !== null;
      if (loop) {
        source.loopStart = loop.start;
        source.loopEnd = loop.end;
      }
    } else if (clock.isPlaying) {
      this.startSource();
    }
    this.onChange.emit();
  }

  private applyRate(): void {
    const clock = this.clock;
    if (!clock) return;
    const now = this.ctx.currentTime;
    clock.setRate(now, this.rate);
    if (this.source) this.source.playbackRate.setValueAtTime(this.rate, now);
  }

  private startSource(): void {
    const clock = this.clock;
    const buffer = this.buffer;
    if (!clock || !buffer) return;
    this.stopSource();
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = clock.rate;
    const loop = clock.loop;
    if (loop) {
      source.loop = true;
      source.loopStart = loop.start;
      source.loopEnd = loop.end;
    }
    source.connect(this.output);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      clock.pause(this.ctx.currentTime);
      this.onChange.emit();
    };
    source.start(0, clock.positionAt(this.ctx.currentTime));
    this.source = source;
  }

  private stopSource(): void {
    const source = this.source;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // すでに止まっているノードの stop() は無視してよい。
    }
    source.disconnect();
    this.source = null;
  }
}
