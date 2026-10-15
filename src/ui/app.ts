import type { Engine } from '../audio/engine';
import type { Controller } from '../control/controller';
import { DECK_IDS } from '../control/controls';
import { computeLedStates, LedFeedback } from '../control/led';
import type { MidiManager } from '../midi/manager';
import { createDeckView } from './deck-view';
import { h } from './dom';
import { createMappingView } from './mapping-view';
import { createMixerView } from './mixer-view';
import { createMonitorView } from './monitor-view';

/** 画面全体を組み立て、毎フレームの描画ループを回す。 */
export function mountApp(
  root: HTMLElement,
  engine: Engine,
  controller: Controller,
  midi: MidiManager,
): void {
  const decks = DECK_IDS.map((id) => createDeckView(engine, controller.registry, id));
  const led = new LedFeedback(midi, controller.bindings, () =>
    computeLedStates(
      { A: engine.decks.A.snapshot(), B: engine.decks.B.snapshot() },
      engine.focused,
      { A: engine.mixer.channels.A.cue, B: engine.mixer.channels.B.cue },
    ),
  );
  // 機器を挿し直したら、LED の状態を送り直す。
  midi.onPortsChanged.on(() => led.resync());
  const mixer = createMixerView(engine, controller, led);

  const banner = h('button', {
    class: 'audio-banner',
    text: '音声が停止しています。クリックして開始（MIDI の操作ではブラウザの許可が下りません）',
    on: { click: () => void engine.resume() },
  });

  // MIDI 入力はユーザー操作として扱われないので、画面への最初の操作で音声を有効にする。
  document.addEventListener('pointerdown', () => void engine.resume());
  document.addEventListener('keydown', () => void engine.resume());

  root.append(
    h('h1', { text: 'nanokeydj' }),
    banner,
    h('div', { class: 'stage' }, decks[0]!.el, mixer.el, decks[1]!.el),
    createMonitorView(midi),
    createMappingView(controller),
  );

  const frame = () => {
    banner.hidden = engine.running;
    for (const deck of decks) deck.update();
    mixer.update();
    led.update();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
