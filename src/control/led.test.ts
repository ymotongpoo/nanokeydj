import { describe, expect, it } from 'vitest';
import type { DeckSnapshot } from '../audio/deck';
import { Bindings } from './bindings';
import type { KeyValueStorage } from './controller';
import { defaultBindings } from './defaults';
import { computeLedStates, LedFeedback, LED_STORAGE_KEY } from './led';

type LedDeck = Parameters<typeof computeLedStates>[0]['A'];

const deck = (overrides: Partial<LedDeck> = {}): LedDeck => ({
  loaded: true,
  playing: false,
  position: 10,
  cuePoint: 0,
  bpm: 124,
  rate: 1,
  keylock: false,
  loop: null,
  ...overrides,
});

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data = { ...initial };
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

describe('computeLedStates', () => {
  it('再生中のデッキの Play が点く', () => {
    const states = computeLedStates({ A: deck({ playing: true }), B: deck() }, 'A');
    expect(states.get('deck.A.play')).toBe(true);
    expect(states.get('deck.B.play')).toBe(false);
  });

  it('止まってキューポイント上にいるときだけ Cue が点く', () => {
    const parked = computeLedStates({ A: deck({ position: 0.01 }), B: deck() }, 'A');
    expect(parked.get('deck.A.cue')).toBe(true);
    const away = computeLedStates({ A: deck({ position: 5 }), B: deck() }, 'A');
    expect(away.get('deck.A.cue')).toBe(false);
    const playing = computeLedStates({ A: deck({ position: 0, playing: true }), B: deck() }, 'A');
    expect(playing.get('deck.A.cue')).toBe(false);
  });

  it('曲がなければ Cue は点かない', () => {
    const states = computeLedStates({ A: deck({ loaded: false, position: 0 }), B: deck() }, 'A');
    expect(states.get('deck.A.cue')).toBe(false);
  });

  it('実効テンポが揃っているあいだ Sync が両方で点く', () => {
    const synced = computeLedStates({ A: deck({ bpm: 124 }), B: deck({ bpm: 128, rate: 124 / 128 }) }, 'A');
    expect(synced.get('deck.A.sync')).toBe(true);
    expect(synced.get('deck.B.sync')).toBe(true);
    const apart = computeLedStates({ A: deck({ bpm: 124 }), B: deck({ bpm: 128 }) }, 'A');
    expect(apart.get('deck.A.sync')).toBe(false);
  });

  it('BPM が分からなければ Sync は点かない', () => {
    const states = computeLedStates({ A: deck({ bpm: null }), B: deck() }, 'A');
    expect(states.get('deck.A.sync')).toBe(false);
  });

  it('キーロックとフォーカスとループ解除が状態を映す', () => {
    const states = computeLedStates(
      { A: deck({ keylock: true }), B: deck({ loop: { start: 1, end: 2 } }) },
      'B',
    );
    expect(states.get('deck.A.keylock')).toBe(true);
    expect(states.get('focus.A')).toBe(false);
    expect(states.get('focus.B')).toBe(true);
    expect(states.get('focused.loop.exit')).toBe(true);
    expect(states.get('focused.play')).toBe(false);
  });
});

describe('LedFeedback', () => {
  function setup(states: Map<string, boolean>, storage = memoryStorage({ [LED_STORAGE_KEY]: '1' })) {
    const sent: number[][] = [];
    const output = { send: (_device: 'nanokontrol2', data: number[]) => (sent.push(data), 1) };
    const bindings = new Bindings(defaultBindings());
    const led = new LedFeedback(output, bindings, () => states, storage);
    return { led, sent, bindings, states };
  }

  it('既定では切れていて、何も送らない', () => {
    const { led, sent } = setup(new Map([['deck.A.play', true]]), memoryStorage());
    expect(led.enabled).toBe(false);
    led.update();
    expect(sent).toEqual([]);
  });

  it('ボタンの CC 番号へ、点灯は 127、消灯は 0 を送る', () => {
    const { led, sent } = setup(
      new Map([
        ['deck.A.play', true],
        ['deck.B.play', false],
      ]),
    );
    led.update();
    expect(sent).toContainEqual([0xb0, 32, 127]); // S1 = Deck A Play
    expect(sent).toContainEqual([0xb0, 36, 0]); // S5 = Deck B Play
  });

  it('変わった LED だけを送る', () => {
    const states = new Map([['deck.A.play', true]]);
    const { led, sent } = setup(states);
    led.update();
    led.update();
    expect(sent).toHaveLength(1);
    states.set('deck.A.play', false);
    led.update();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual([0xb0, 32, 0]);
  });

  it('学習で割り当てを変えたら、新しい番号へ送る', () => {
    const { led, sent, bindings } = setup(new Map([['deck.A.play', true]]));
    bindings.unbindControl('deck.A.play');
    bindings.bind({ device: 'nanokontrol2', type: 'cc', number: 70 }, 'deck.A.play');
    led.update();
    expect(sent).toEqual([[0xb0, 70, 127]]);
  });

  it('nanoKONTROL2 以外の割り当ては無視する', () => {
    const { led, sent, bindings } = setup(new Map([['deck.A.hotcue.1', true]]));
    bindings.bind({ device: 'nanopad2', type: 'note', number: 36 }, 'deck.A.hotcue.1');
    led.update();
    expect(sent).toEqual([]);
  });

  it('切ると点いていた LED を消し、設定を保存する', () => {
    const storage = memoryStorage({ [LED_STORAGE_KEY]: '1' });
    const { led, sent } = setup(new Map([['deck.A.play', true]]), storage);
    led.update();
    sent.length = 0;
    led.enabled = false;
    expect(sent).toEqual([[0xb0, 32, 0]]);
    expect(storage.getItem(LED_STORAGE_KEY)).toBe('0');
    led.update();
    expect(sent).toHaveLength(1);
  });

  it('resync で全 LED を送り直す', () => {
    const { led, sent } = setup(new Map([['deck.A.play', true]]));
    led.update();
    led.resync();
    led.update();
    expect(sent).toHaveLength(2);
  });
});

// 型の確認: DeckSnapshot から必要な項目だけ渡せる。
void (null as unknown as DeckSnapshot satisfies Parameters<typeof computeLedStates>[0]['A']);
