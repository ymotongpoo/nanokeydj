import { DECK_IDS, type DeckId } from '../control/controls';
import { Deck } from './deck';
import { Mixer } from './mixer';

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

  constructor(ctx: AudioContext = new AudioContext({ latencyHint: 'interactive' })) {
    this.ctx = ctx;
    this.mixer = new Mixer(ctx);
    this.decks = { A: new Deck('A', ctx), B: new Deck('B', ctx) };
    for (const id of DECK_IDS) this.decks[id].output.connect(this.mixer.channels[id].input);
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
    this.decks[deck].load(buffer, file.name.replace(/\.[^.]+$/, ''));
  }
}
