import { describe, expect, it, vi } from 'vitest';
import { Bindings, eventToInput, sourceKey } from './bindings';
import { Controller, STORAGE_KEY, type KeyValueStorage } from './controller';
import { allControlDefs } from './controls';
import { defaultBindings } from './defaults';
import { ControlRegistry } from './registry';
import type { MidiEvent } from '../midi/manager';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const ev = (device: MidiEvent['device'], message: MidiEvent['message']): MidiEvent => ({
  device,
  portName: 'test',
  message,
  timeStamp: 0,
});

describe('eventToInput', () => {
  it('CC を 0〜1 に正規化する', () => {
    const input = eventToInput(
      ev('nanokontrol2', { type: 'cc', channel: 1, controller: 16, value: 127 }),
    );
    expect(input).toEqual({
      source: { device: 'nanokontrol2', type: 'cc', number: 16 },
      value: 1,
    });
  });

  it('nanoKEY2 のノートをオクターブ無視の音名にする', () => {
    const low = eventToInput(ev('nanokey2', { type: 'noteOn', channel: 1, note: 48, velocity: 90 }));
    const high = eventToInput(ev('nanokey2', { type: 'noteOn', channel: 1, note: 60, velocity: 90 }));
    expect(low?.source).toEqual({ device: 'nanokey2', type: 'noteClass', number: 0 });
    expect(high?.source).toEqual(low?.source);
  });

  it('nanoPAD2 のノートはそのまま使う', () => {
    const input = eventToInput(ev('nanopad2', { type: 'noteOn', channel: 10, note: 36, velocity: 1 }));
    expect(input?.source).toEqual({ device: 'nanopad2', type: 'note', number: 36 });
    expect(input?.value).toBeGreaterThan(0);
  });

  it('ノートオフは値 0 になる', () => {
    const input = eventToInput(ev('nanopad2', { type: 'noteOff', channel: 10, note: 36, velocity: 0 }));
    expect(input?.value).toBe(0);
  });

  it('ピッチベンドは中央が 0.5 付近になる', () => {
    const input = eventToInput(ev('nanokey2', { type: 'pitchBend', channel: 1, value: 8192 }));
    expect(input?.value).toBeCloseTo(0.5, 2);
  });

  it('対象外のメッセージは null', () => {
    expect(eventToInput(ev('nanokey2', { type: 'programChange', channel: 1, program: 1 }))).toBeNull();
  });
});

describe('ControlRegistry', () => {
  const setup = () => {
    const registry = new ControlRegistry();
    const play = vi.fn();
    const cue = vi.fn();
    const volume = vi.fn();
    registry.setHandler('deck.A.play', play);
    registry.setHandler('deck.A.cue', cue);
    registry.setHandler('mixer.A.volume', volume);
    return { registry, play, cue, volume };
  };

  it('trigger は押下の 1 回だけ働き、離しても働かない', () => {
    const { registry, play } = setup();
    registry.dispatch('deck.A.play', 1);
    registry.dispatch('deck.A.play', 1);
    registry.dispatch('deck.A.play', 0);
    expect(play).toHaveBeenCalledTimes(1);
    registry.dispatch('deck.A.play', 0.5);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('hold は押下と解放をそれぞれ伝える', () => {
    const { registry, cue } = setup();
    registry.dispatch('deck.A.cue', 1);
    registry.dispatch('deck.A.cue', 0);
    expect(cue.mock.calls).toEqual([[1], [0]]);
  });

  it('continuous は値をそのまま渡し、範囲に丸める', () => {
    const { registry, volume } = setup();
    registry.dispatch('mixer.A.volume', 0.25);
    registry.dispatch('mixer.A.volume', 2);
    expect(volume.mock.calls).toEqual([[0.25], [1]]);
  });

  it('未定義のコントロールは無視し、ハンドラー登録は拒む', () => {
    const { registry } = setup();
    expect(() => registry.dispatch('nope', 1)).not.toThrow();
    expect(() => registry.setHandler('nope', () => {})).toThrow();
  });
});

describe('Bindings', () => {
  it('同じ入力元への割り当てを上書きする', () => {
    const bindings = new Bindings();
    const source = { device: 'nanokontrol2', type: 'cc', number: 1 } as const;
    bindings.bind(source, 'mixer.master');
    bindings.bind(source, 'mixer.crossfader');
    expect(bindings.resolve(source)).toBe('mixer.crossfader');
  });

  it('コントロールに結びつく入力元を外せる', () => {
    const bindings = new Bindings();
    const source = { device: 'nanokontrol2', type: 'cc', number: 1 } as const;
    bindings.bind(source, 'mixer.master');
    bindings.unbindControl('mixer.master');
    expect(bindings.resolve(source)).toBeUndefined();
  });
});

describe('defaultBindings', () => {
  it('すべて定義済みのコントロールを指す', () => {
    const ids = new Set(allControlDefs().map((d) => d.id));
    for (const binding of defaultBindings()) expect(ids.has(binding.control)).toBe(true);
  });

  it('入力元が重複しない', () => {
    const keys = defaultBindings().map(sourceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('2 つのデッキ分のホットキューが nanoPAD2 の 16 パッドに行き渡る', () => {
    const pads = defaultBindings().filter((b) => b.device === 'nanopad2');
    expect(pads).toHaveLength(16);
  });
});

describe('Controller', () => {
  it('MIDI 入力を初期割り当てでコントロールに配信する', () => {
    const controller = new Controller(null, memoryStorage());
    const volume = vi.fn();
    controller.registry.setHandler('mixer.A.volume', volume);
    controller.handleInput({ device: 'nanokontrol2', type: 'cc', number: 0 }, 0.5);
    expect(volume).toHaveBeenCalledWith(0.5);
  });

  it('学習中は入力を消費してコントロールを動かさない', () => {
    const controller = new Controller(null, memoryStorage());
    const volume = vi.fn();
    controller.registry.setHandler('mixer.A.volume', volume);
    controller.learner.start(['mixer.master']);
    controller.handleInput({ device: 'nanokontrol2', type: 'cc', number: 0 }, 0.5);
    expect(volume).not.toHaveBeenCalled();
    expect(controller.bindings.resolve({ device: 'nanokontrol2', type: 'cc', number: 0 })).toBe(
      'mixer.master',
    );
  });

  it('ボタンの学習は離した 0 では進まない', () => {
    const controller = new Controller(null, memoryStorage());
    controller.learner.start(['deck.A.play']);
    const source = { device: 'nanopad2', type: 'note', number: 70 } as const;
    controller.handleInput(source, 0);
    expect(controller.learner.target).toBe('deck.A.play');
    controller.handleInput(source, 0.8);
    expect(controller.learner.target).toBeNull();
    expect(controller.bindings.resolve(source)).toBe('deck.A.play');
  });

  it('連続学習で動かし続けているフェーダーを次の項目に割り当てない', () => {
    const controller = new Controller(null, memoryStorage());
    controller.learner.start(['mixer.A.volume', 'mixer.B.volume']);
    const fader = { device: 'nanokontrol2', type: 'cc', number: 9 } as const;
    controller.handleInput(fader, 0.1);
    controller.handleInput(fader, 0.2);
    expect(controller.learner.target).toBe('mixer.B.volume');
    controller.handleInput({ device: 'nanokontrol2', type: 'cc', number: 10 }, 0.3);
    expect(controller.learner.target).toBeNull();
  });

  it('学習結果を保存し、次回の起動で読み戻す', () => {
    const storage = memoryStorage();
    const first = new Controller(null, storage);
    first.learner.start(['mixer.master']);
    first.handleInput({ device: 'nanokontrol2', type: 'cc', number: 99 }, 0.5);
    expect(storage.data[STORAGE_KEY]).toBeDefined();

    const second = new Controller(null, storage);
    expect(second.bindings.resolve({ device: 'nanokontrol2', type: 'cc', number: 99 })).toBe(
      'mixer.master',
    );
    // 再学習で元の入力元は外れている。
    expect(second.bindings.resolve({ device: 'nanokontrol2', type: 'cc', number: 3 })).toBeUndefined();
  });

  it('壊れた保存データは初期値に戻す', () => {
    const controller = new Controller(null, memoryStorage({ [STORAGE_KEY]: '{oops' }));
    expect(controller.bindings.resolve({ device: 'nanokontrol2', type: 'cc', number: 0 })).toBe(
      'mixer.A.volume',
    );
  });

  it('初期値に戻せる', () => {
    const storage = memoryStorage();
    const controller = new Controller(null, storage);
    controller.learner.start(['mixer.master']);
    controller.handleInput({ device: 'nanokontrol2', type: 'cc', number: 99 }, 0.5);
    controller.resetToDefaults();
    expect(controller.bindings.resolve({ device: 'nanokontrol2', type: 'cc', number: 3 })).toBe(
      'mixer.master',
    );
    expect(controller.bindings.resolve({ device: 'nanokontrol2', type: 'cc', number: 99 })).toBeUndefined();
    expect(storage.data[STORAGE_KEY]).toBeUndefined();
  });
});
