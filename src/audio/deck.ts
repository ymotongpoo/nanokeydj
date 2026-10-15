import { HOTCUE_COUNT, type DeckId } from '../control/controls';
import { Emitter } from '../util/emitter';
import { beatLoopRegion, phaseCorrection } from './beatgrid';
import { PlaybackClock, type LoopRegion } from './clock';
import type { Stretcher } from './stretch-player';

/** nudge（一時的なテンポ微調整）の最大幅。±5 %。 */
const NUDGE_DEPTH = 0.05;

/** Cue ボタンで、いまの位置がキューポイント上にあるとみなす許容幅（秒）。 */
const CUE_EPSILON = 0.03;

/** 手動ループの最短の長さ（秒）。誤操作で極端に短いループが入るのを防ぐ。 */
const MIN_LOOP_SECONDS = 0.02;

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
  cuePoint: number;
  hotcues: (number | null)[];
  /** ループインだけ押して、アウトを待っているときの始点。 */
  loopInPoint: number | null;
  keylock: boolean;
  keylockAvailable: boolean;
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
  private _cuePoint = 0;
  private _hotcues: (number | null)[] = Array.from({ length: HOTCUE_COUNT }, () => null);
  private previewing = false;
  private _loopInPoint: number | null = null;
  private stretcher: Stretcher | null = null;
  private _keylock = false;
  /** いま音を出しているのが時間伸縮の経路か。 */
  private stretching = false;

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

  get cuePoint(): number {
    return this._cuePoint;
  }

  get hotcues(): readonly (number | null)[] {
    return this._hotcues;
  }

  get loopInPoint(): number | null {
    return this._loopInPoint;
  }

  /** キーロック: テンポを変えても音程を変えない。 */
  get keylock(): boolean {
    return this._keylock;
  }

  get keylockAvailable(): boolean {
    return this.stretcher !== null;
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
      cuePoint: this._cuePoint,
      hotcues: [...this._hotcues],
      loopInPoint: this._loopInPoint,
      keylock: this._keylock,
      keylockAvailable: this.stretcher !== null,
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
    this._cuePoint = 0;
    this._hotcues = this._hotcues.map(() => null);
    this.previewing = false;
    this._loopInPoint = null;
    if (this._keylock) this.loadStretcherData();
    this.onChange.emit();
  }

  /** ワークレットが使えるようになったら、エンジンが渡す。 */
  attachStretcher(stretcher: Stretcher): void {
    this.stretcher = stretcher;
    stretcher.output.connect(this.output);
    stretcher.onEnded = () => {
      if (!this.stretching) return;
      this.stretching = false;
      this.clock?.pause(this.ctx.currentTime);
      this.onChange.emit();
    };
    if (this._keylock) this.loadStretcherData();
    this.onChange.emit();
  }

  setKeylock(on: boolean): void {
    if (on === this._keylock || (on && !this.stretcher)) return;
    this._keylock = on;
    if (on) this.loadStretcherData();
    // 再生中なら、新しい経路で同じ位置から鳴らし直す。
    if (this.clock?.isPlaying) this.startSource();
    if (!on) this.stretcher?.unload();
    this.onChange.emit();
  }

  /** 時間伸縮は曲のサンプルをワークレットへ複製するので、キーロックが入っているときだけ渡す。 */
  private loadStretcherData(): void {
    const buffer = this.buffer;
    if (!this.stretcher || !buffer) return;
    this.stretcher.load(
      Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)),
    );
  }

  setAnalyzing(analyzing: boolean): void {
    this._analyzing = analyzing;
    this.onChange.emit();
  }

  setAnalysis(bpm: number, firstBeat: number): void {
    this._bpm = bpm;
    this._firstBeat = firstBeat;
    // 自分で打っていなければ、キューポイントは最初の拍に置く。
    if (this._cuePoint === 0) this._cuePoint = firstBeat;
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
    if (this.previewing) {
      // Cue を押したまま Play を押すと、Cue を離しても再生を続ける。
      this.previewing = false;
      return;
    }
    if (this.playing) this.pause();
    else this.play();
  }

  /**
   * CDJ 方式の Cue。再生中ならキューポイントへ戻って止まる。
   * 止まっていて位置がキューポイントなら、押している間だけ再生する。
   * 止まっていてキューポイントから離れていれば、そこを新しいキューポイントにする。
   */
  cuePress(): void {
    if (!this.clock) return;
    if (this.playing) {
      this.pause();
      this.seek(this._cuePoint);
    } else if (Math.abs(this.position - this._cuePoint) < CUE_EPSILON) {
      this.previewing = true;
      this.play();
    } else {
      this._cuePoint = this.position;
      this.onChange.emit();
    }
  }

  cueRelease(): void {
    if (!this.previewing) return;
    this.previewing = false;
    this.pause();
    this.seek(this._cuePoint);
  }

  /** 空きなら今の位置に打つ。打ってあれば、そこへ飛んで再生する。 */
  hotcue(index: number): void {
    if (!this.clock || index < 0 || index >= HOTCUE_COUNT) return;
    const cue = this._hotcues[index];
    if (cue === null || cue === undefined) {
      this._hotcues[index] = this.position;
      this.onChange.emit();
      return;
    }
    this.seek(cue);
    this.play();
  }

  clearHotcue(index: number): void {
    if (index < 0 || index >= HOTCUE_COUNT || this._hotcues[index] === null) return;
    this._hotcues[index] = null;
    this.onChange.emit();
  }

  /** beats 拍のループを入れる。同じ長さのループが入っていれば解除する。 */
  beatLoop(beats: number): void {
    if (!this.clock || this._bpm === null) return;
    const active = this.loop;
    const length = (beats * 60) / this._bpm;
    if (active && Math.abs(active.end - active.start - length) < 1e-6) {
      this.setLoop(null);
      return;
    }
    this.setLoop(beatLoopRegion(this.position, this._firstBeat, this._bpm, beats));
  }

  /**
   * ループイン。ループ中ならループの始点を今の位置へ動かす。
   * ループがなければ始点だけを覚え、ループアウトで確定する。
   */
  loopIn(): void {
    if (!this.clock) return;
    const position = this.position;
    const loop = this.loop;
    if (loop) {
      if (loop.end - position >= MIN_LOOP_SECONDS) this.setLoop({ start: position, end: loop.end });
      return;
    }
    this._loopInPoint = position;
    this.onChange.emit();
  }

  /** ループアウト。ループ中ならループの終点を今の位置へ動かす。 */
  loopOut(): void {
    if (!this.clock) return;
    const position = this.position;
    const loop = this.loop;
    if (loop) {
      if (position - loop.start >= MIN_LOOP_SECONDS) this.setLoop({ start: loop.start, end: position });
      return;
    }
    const start = this._loopInPoint;
    if (start === null || position - start < MIN_LOOP_SECONDS) return;
    this._loopInPoint = null;
    this.setLoop({ start, end: position });
  }

  /** ループを解除する。ループイン待ちのときは、その始点も取り消す。 */
  exitLoop(): void {
    if (this.loop) {
      this.setLoop(null);
    } else if (this._loopInPoint !== null) {
      this._loopInPoint = null;
      this.onChange.emit();
    }
  }

  /** 拍の数だけ位置を前後させる。ループ中はループも一緒に動かす。曲の外に出るなら何もしない。 */
  beatJump(beats: number): void {
    if (!this.clock || this._bpm === null) return;
    const offset = (beats * 60) / this._bpm;
    const loop = this.loop;
    const target = this.position + offset;
    if (target < 0 || target >= this.duration) return;
    if (loop) {
      const shifted = { start: loop.start + offset, end: loop.end + offset };
      if (shifted.start < 0 || shifted.end > this.duration) return;
      this.setLoop(shifted);
    }
    this.seek(target);
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
    const unchanged = Math.abs(after - before) < 1e-3;
    if (source && unchanged) {
      // 位置が変わらないなら、再生中のノードのループ設定だけを差し替える（途切れない）。
      source.loop = loop !== null;
      if (loop) {
        source.loopStart = loop.start;
        source.loopEnd = loop.end;
      }
    } else if (this.stretching && unchanged) {
      this.stretcher?.setLoop(loop);
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
    if (this.stretching) this.stretcher?.setRate(this.rate);
  }

  private startSource(): void {
    const clock = this.clock;
    const buffer = this.buffer;
    if (!clock || !buffer) return;
    this.stopSource();
    if (this._keylock && this.stretcher) {
      this.stretcher.play(this.ctx.currentTime, clock.positionAt(this.ctx.currentTime), clock.rate, clock.loop);
      this.stretching = true;
      return;
    }
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
    if (this.stretching) {
      this.stretcher?.stop();
      this.stretching = false;
    }
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
