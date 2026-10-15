import { DECK_IDS, type DeckId } from '../control/controls';
import { analyzeBpm } from './bpm-client';
import { Deck } from './deck';
import { Mixer } from './mixer';
import { mixToMono } from './peaks';
import { StretchPlayer } from './stretch-player';
import { TrackStore, trackKey } from './track-store';

const QUANTIZE_STORAGE_KEY = 'nanokeydj.quantize';

export interface DeckBuffers {
  A: AudioBuffer | null;
  B: AudioBuffer | null;
}

/** AudioContext、2 台のデッキ、ミキサーをまとめる。 */
export class Engine {
  readonly ctx: AudioContext;
  readonly mixer: Mixer;
  readonly decks: Record<DeckId, Deck>;
  /** ±何 % までテンポを動かせるか。 */
  tempoRange = 8;
  /** true なら DJ 機器の慣習どおり、フェーダーの上側が遅くなる。 */
  tempoInvert = true;
  focused: DeckId = 'A';
  /** キーロック（AudioWorklet）が使えるようになったか。使えない環境では false で解決する。 */
  readonly keylockReady: Promise<boolean>;
  private _quantize = false;

  private store = new TrackStore();
  private trackKeys: Record<DeckId, string | null> = { A: null, B: null };
  private lastSaved: Record<DeckId, string> = { A: '', B: '' };
  private saveTimers: Partial<Record<DeckId, ReturnType<typeof setTimeout>>> = {};

  constructor(ctx: AudioContext = new AudioContext({ latencyHint: 'interactive' })) {
    this.ctx = ctx;
    this.mixer = new Mixer(ctx);
    this.decks = { A: new Deck('A', ctx), B: new Deck('B', ctx) };
    for (const id of DECK_IDS) this.decks[id].output.connect(this.mixer.channels[id].input);
    this._quantize = localStorage.getItem(QUANTIZE_STORAGE_KEY) === '1';
    for (const id of DECK_IDS) this.decks[id].quantize = this._quantize;
    for (const id of DECK_IDS) this.decks[id].onChange.on(() => this.scheduleSave(id));
    this.keylockReady = this.initKeylock();
  }

  /** キューとホットキューとループの位置を、最寄りの拍に揃える。 */
  get quantize(): boolean {
    return this._quantize;
  }

  set quantize(enabled: boolean) {
    this._quantize = enabled;
    localStorage.setItem(QUANTIZE_STORAGE_KEY, enabled ? '1' : '0');
    for (const id of DECK_IDS) this.decks[id].quantize = enabled;
  }

  /** グリッドやキューの手直しを、少し間を置いて曲ごとに保存する。 */
  private scheduleSave(id: DeckId): void {
    clearTimeout(this.saveTimers[id]);
    this.saveTimers[id] = setTimeout(() => this.saveNow(id), 400);
  }

  private saveNow(id: DeckId): void {
    const key = this.trackKeys[id];
    const deck = this.decks[id];
    if (!key || !deck.loaded || deck.analyzing) return;
    const state = deck.exportState();
    const json = JSON.stringify(state);
    if (json === this.lastSaved[id]) return;
    this.lastSaved[id] = json;
    this.store.set(key, state);
  }

  private async initKeylock(): Promise<boolean> {
    try {
      await StretchPlayer.register(this.ctx);
      for (const id of DECK_IDS) this.decks[id].attachStretcher(new StretchPlayer(this.ctx));
      return true;
    } catch (error) {
      console.warn('キーロックを初期化できませんでした', error);
      return false;
    }
  }

  get running(): boolean {
    return this.ctx.state === 'running';
  }

  /** ブラウザの自動再生ポリシーのため、ユーザー操作の中で呼ぶ。 */
  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  async loadFile(deck: DeckId, file: File): Promise<void> {
    const buffer = await this.decode(await file.arrayBuffer());
    this.loadBuffer(deck, buffer, file.name.replace(/\.[^.]+$/, ''));
  }

  /** デッキに曲を載せ、BPM の解析を裏で始める。解析中に別の曲へ替わっていたら結果は捨てる。 */
  loadBuffer(id: DeckId, buffer: AudioBuffer, name: string): void {
    const deck = this.decks[id];
    deck.load(buffer, name);

    // 前に手直しした曲なら、その状態を戻す。BPM が分かっていれば解析はしない。
    const key = trackKey(name, buffer.duration);
    this.trackKeys[id] = key;
    const saved = this.store.get(key);
    this.lastSaved[id] = saved ? JSON.stringify(saved) : '';
    if (saved) deck.restore(saved);
    if (saved?.bpm != null) return;

    deck.setAnalyzing(true);
    void analyzeBpm(mixToMono(buffer), buffer.sampleRate).then((result) => {
      if (deck.audio !== buffer) return;
      deck.setAnalyzing(false);
      if (result) deck.setAnalysis(result.bpm, result.firstBeat);
    });
  }
}
