import { tempoRate } from '../audio/curves';
import type { Deck } from '../audio/deck';
import type { Engine } from '../audio/engine';
import { DECK_IDS, EQ_BANDS, HOTCUE_COUNT, JUMP_BEATS, LOOP_BEATS, type DeckId } from './controls';
import type { ControlRegistry } from './registry';

/** マスターエフェクトの素通しの位置。X は中央、Y（エコー）は 0。 */
const FX_NEUTRAL_X = 0.5;
const FX_NEUTRAL_Y = 0;

/** ピッチベンドが中央付近のときは nudge を掛けない。 */
const NUDGE_DEAD_ZONE = 0.05;

/** 連続値コントロールの起動時の値。実機のフェーダー位置とは無関係に、安全な位置から始める。 */
const INITIAL_VALUES: Record<string, number> = {
  'mixer.crossfader': 0.5,
  'mixer.master': 0.8,
  'mixer.headphone.volume': 0.7,
  'mixer.headphone.mix': 0.5,
  'fx.x': FX_NEUTRAL_X,
  'fx.y': FX_NEUTRAL_Y,
};

/** レジストリのコントロールを、エンジンの操作に結びつける。 */
export function wireControls(registry: ControlRegistry, engine: Engine): void {
  const focusedDeck = () => engine.decks[engine.focused];
  /** Cue を押している間のデッキ。押している間にフォーカスが替わっても、同じデッキを離す。 */
  let cueHeld: Deck | null = null;

  for (const id of DECK_IDS) {
    const deck = engine.decks[id];
    const strip = engine.mixer.channels[id];

    registry.setHandler(`deck.${id}.play`, () => deck.togglePlay());
    registry.setHandler(`deck.${id}.sync`, () => deck.sync(engine.decks[otherDeck(id)]));
    registry.setHandler(`deck.${id}.keylock`, () => deck.setKeylock(!deck.keylock));
    registry.setHandler(`deck.${id}.tempo`, (v) =>
      deck.setTempoRate(tempoRate(v, engine.tempoRange, engine.tempoInvert)),
    );
    registry.setHandler(`mixer.${id}.volume`, (v) => strip.setVolume(v));
    registry.setHandler(`mixer.${id}.cue`, () => strip.setCue(!strip.cue));
    for (const band of EQ_BANDS) {
      registry.setHandler(`mixer.${id}.eq.${band}`, (v) => strip.setEq(band, v));
    }
    registry.setHandler(`mixer.${id}.filter`, (v) => strip.setFilter(v));
    registry.setHandler(`deck.${id}.cue`, (v) => (v > 0 ? deck.cuePress() : deck.cueRelease()));
    for (let n = 1; n <= HOTCUE_COUNT; n++) {
      registry.setHandler(`deck.${id}.hotcue.${n}`, () => {
        if (registry.value('modifier.delete') > 0) deck.clearHotcue(n - 1);
        else deck.hotcue(n - 1);
      });
    }
    registry.setHandler(`focus.${id}`, () => {
      if (engine.focused !== id) focusedDeck().setNudge(0);
      engine.focused = id;
    });

    INITIAL_VALUES[`deck.${id}.tempo`] = 0.5;
    INITIAL_VALUES[`mixer.${id}.volume`] = 0.8;
    for (const band of EQ_BANDS) INITIAL_VALUES[`mixer.${id}.eq.${band}`] = 0.5;
    INITIAL_VALUES[`mixer.${id}.filter`] = 0.5;
  }

  registry.setHandler('mixer.crossfader', (v) => engine.mixer.setCrossfader(v));
  registry.setHandler('mixer.master', (v) => engine.mixer.setMaster(v));
  registry.setHandler('mixer.headphone.volume', (v) => engine.mixer.setHeadphoneVolume(v));
  registry.setHandler('mixer.headphone.mix', (v) => engine.mixer.setHeadphoneMix(v));
  const applyFx = () => engine.mixer.setFx(registry.value('fx.x'), registry.value('fx.y'));
  registry.setHandler('fx.x', applyFx);
  registry.setHandler('fx.y', applyFx);
  registry.setHandler('fx.reset', () => {
    registry.dispatch('fx.x', FX_NEUTRAL_X);
    registry.dispatch('fx.y', FX_NEUTRAL_Y);
  });
  registry.setHandler('focused.play', () => focusedDeck().togglePlay());
  registry.setHandler('focused.cue', (v) => {
    if (v > 0) {
      cueHeld = focusedDeck();
      cueHeld.cuePress();
    } else {
      cueHeld?.cueRelease();
      cueHeld = null;
    }
  });
  registry.setHandler('focused.nudge', (v) => {
    const offset = (v - 0.5) * 2;
    focusedDeck().setNudge(Math.abs(offset) < NUDGE_DEAD_ZONE ? 0 : offset);
  });
  registry.setHandler('focused.loop.in', () => focusedDeck().loopIn());
  registry.setHandler('focused.loop.out', () => focusedDeck().loopOut());
  registry.setHandler('focused.loop.exit', () => focusedDeck().exitLoop());
  for (const beats of LOOP_BEATS) {
    registry.setHandler(`focused.loop.${beats}`, () => focusedDeck().beatLoop(beats));
  }
  for (const beats of JUMP_BEATS) {
    registry.setHandler(`focused.jump.${beats}`, () => focusedDeck().beatJump(beats));
  }
  registry.setHandler('focused.sync', () => {
    const deck = focusedDeck();
    deck.sync(engine.decks[otherDeck(deck.id)]);
  });

  for (const [id, value] of Object.entries(INITIAL_VALUES)) registry.dispatch(id, value);
}

export function otherDeck(id: DeckId): DeckId {
  return id === 'A' ? 'B' : 'A';
}
