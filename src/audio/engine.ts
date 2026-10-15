import { DECK_IDS, type DeckId } from '../control/controls';
import { analyzeBpm } from './bpm-client';
import { Deck } from './deck';
import { Mixer } from './mixer';
import { mixToMono } from './peaks';
import { StretchPlayer } from './stretch-player';

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

  constructor(ctx: AudioContext = new AudioContext({ latencyHint: 'interactive' })) {
    this.ctx = ctx;
    this.mixer = new Mixer(ctx);
    this.decks = { A: new Deck('A', ctx), B: new Deck('B', ctx) };
    for (const id of DECK_IDS) this.decks[id].output.connect(this.mixer.channels[id].input);
    this.keylockReady = this.initKeylock();
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
    deck.setAnalyzing(true);
    void analyzeBpm(mixToMono(buffer), buffer.sampleRate).then((result) => {
      if (deck.audio !== buffer) return;
      deck.setAnalyzing(false);
      if (result) deck.setAnalysis(result.bpm, result.firstBeat);
    });
  }
}
