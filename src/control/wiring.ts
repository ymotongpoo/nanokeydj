import { tempoRate } from '../audio/curves';
import type { Engine } from '../audio/engine';
import { DECK_IDS, EQ_BANDS, type DeckId } from './controls';
import type { ControlRegistry } from './registry';

/** 連続値コントロールの起動時の値。実機のフェーダー位置とは無関係に、安全な位置から始める。 */
const INITIAL_VALUES: Record<string, number> = {
  'mixer.crossfader': 0.5,
  'mixer.master': 0.8,
};

/** レジストリのコントロールを、エンジンの操作に結びつける。 */
export function wireControls(registry: ControlRegistry, engine: Engine): void {
  const focusedDeck = () => engine.decks[engine.focused];

  for (const id of DECK_IDS) {
    const deck = engine.decks[id];
    const strip = engine.mixer.channels[id];

    registry.setHandler(`deck.${id}.play`, () => deck.togglePlay());
    registry.setHandler(`deck.${id}.sync`, () => deck.sync(engine.decks[otherDeck(id)]));
    registry.setHandler(`deck.${id}.tempo`, (v) =>
      deck.setTempoRate(tempoRate(v, engine.tempoRange, engine.tempoInvert)),
    );
    registry.setHandler(`mixer.${id}.volume`, (v) => strip.setVolume(v));
    for (const band of EQ_BANDS) {
      registry.setHandler(`mixer.${id}.eq.${band}`, (v) => strip.setEq(band, v));
    }
    registry.setHandler(`mixer.${id}.filter`, (v) => strip.setFilter(v));
    registry.setHandler(`focus.${id}`, () => {
      engine.focused = id;
    });

    INITIAL_VALUES[`deck.${id}.tempo`] = 0.5;
    INITIAL_VALUES[`mixer.${id}.volume`] = 0.8;
    for (const band of EQ_BANDS) INITIAL_VALUES[`mixer.${id}.eq.${band}`] = 0.5;
    INITIAL_VALUES[`mixer.${id}.filter`] = 0.5;
  }

  registry.setHandler('mixer.crossfader', (v) => engine.mixer.setCrossfader(v));
  registry.setHandler('mixer.master', (v) => engine.mixer.setMaster(v));
  registry.setHandler('focused.play', () => focusedDeck().togglePlay());
  registry.setHandler('focused.sync', () => {
    const deck = focusedDeck();
    deck.sync(engine.decks[otherDeck(deck.id)]);
  });

  for (const [id, value] of Object.entries(INITIAL_VALUES)) registry.dispatch(id, value);
}

export function otherDeck(id: DeckId): DeckId {
  return id === 'A' ? 'B' : 'A';
}
