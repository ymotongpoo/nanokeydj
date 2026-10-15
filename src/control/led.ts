import type { DeckSnapshot } from '../audio/deck';
import type { DeckId } from './controls';
import type { Bindings } from './bindings';
import type { KeyValueStorage } from './controller';

export const LED_STORAGE_KEY = 'nanokeydj.led';

/** キューポイント上に止まっているとみなす許容幅（秒）。 */
const AT_CUE_EPSILON = 0.03;
/** Sync しているとみなすテンポ差（BPM）。 */
const SYNC_TOLERANCE_BPM = 0.05;

type LedDeck = Pick<
  DeckSnapshot,
  'loaded' | 'playing' | 'position' | 'cuePoint' | 'bpm' | 'rate' | 'keylock' | 'loop'
>;

/** コントロール ID ごとに、LED を点けるべきか。 */
export function computeLedStates(
  decks: Record<DeckId, LedDeck>,
  focused: DeckId,
): Map<string, boolean> {
  const states = new Map<string, boolean>();
  const tempo = (deck: LedDeck) => (deck.bpm === null ? null : deck.bpm * deck.rate);
  const tempoA = tempo(decks.A);
  const tempoB = tempo(decks.B);
  const synced =
    tempoA !== null && tempoB !== null && Math.abs(tempoA - tempoB) < SYNC_TOLERANCE_BPM;

  for (const id of ['A', 'B'] as const) {
    const deck = decks[id];
    states.set(`deck.${id}.play`, deck.playing);
    states.set(
      `deck.${id}.cue`,
      deck.loaded && !deck.playing && Math.abs(deck.position - deck.cuePoint) < AT_CUE_EPSILON,
    );
    states.set(`deck.${id}.sync`, synced);
    states.set(`deck.${id}.keylock`, deck.keylock);
    states.set(`focus.${id}`, focused === id);
  }
  states.set('focused.play', decks[focused].playing);
  states.set('focused.loop.exit', decks[focused].loop !== null);
  return states;
}

export interface LedOutput {
  send(device: 'nanokontrol2', data: number[]): number;
}

/**
 * nanoKONTROL2 のボタン LED を、デッキの状態に合わせて点灯させる。
 * KONTROL Editor で LED モードを「External」にしておく必要がある。
 * 割り当てを学習で変えても追従するよう、LED の番号は現在のバインディングから引く。
 */
export class LedFeedback {
  private _enabled: boolean;
  private sent = new Map<number, boolean>();

  constructor(
    private output: LedOutput,
    private bindings: Bindings,
    private states: () => Map<string, boolean>,
    private storage: KeyValueStorage | null = typeof localStorage === 'undefined' ? null : localStorage,
  ) {
    this._enabled = storage?.getItem(LED_STORAGE_KEY) === '1';
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(enabled: boolean) {
    if (enabled === this._enabled) return;
    this._enabled = enabled;
    this.storage?.setItem(LED_STORAGE_KEY, enabled ? '1' : '0');
    if (!enabled) this.allOff();
    else this.sent.clear();
  }

  /** 毎フレーム呼ぶ。前回から変わった LED だけを送る。 */
  update(): void {
    if (!this._enabled) return;
    const desired = new Map<number, boolean>();
    for (const [control, on] of this.states()) {
      for (const source of this.bindings.sourcesFor(control)) {
        if (source.device !== 'nanokontrol2' || source.type !== 'cc') continue;
        desired.set(source.number, (desired.get(source.number) ?? false) || on);
      }
    }
    for (const [cc, on] of desired) {
      if (this.sent.get(cc) === on) continue;
      this.output.send('nanokontrol2', [0xb0, cc, on ? 127 : 0]);
      this.sent.set(cc, on);
    }
  }

  /** 機器を挿し直したときなど、全 LED を送り直す。 */
  resync(): void {
    this.sent.clear();
  }

  private allOff(): void {
    for (const [cc, on] of this.sent) {
      if (on) this.output.send('nanokontrol2', [0xb0, cc, 0]);
    }
    this.sent.clear();
  }
}
