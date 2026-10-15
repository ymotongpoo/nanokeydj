import type { Engine } from '../audio/engine';
import type { CrossfaderCurve } from '../audio/curves';
import { DECK_IDS, type DeckId } from '../control/controls';
import type { Controller } from '../control/controller';
import type { LedFeedback } from '../control/led';
import { createSlider } from './controls';
import { h } from './dom';

const TEMPO_RANGES = [6, 8, 10, 16, 25, 50];

function createMeter(): { el: HTMLElement; set: (level: number) => void } {
  const fill = h('div', { class: 'meter-fill' });
  return {
    el: h('div', { class: 'meter' }, fill),
    set: (level) => {
      fill.style.height = `${Math.min(1, level) * 100}%`;
    },
  };
}

export interface MixerView {
  el: HTMLElement;
  update(): void;
}

export function createMixerView(
  engine: Engine,
  controller: Controller,
  led: LedFeedback,
): MixerView {
  const registry = controller.registry;
  const updaters: (() => void)[] = [];
  const meters = new Map<DeckId | 'master', ReturnType<typeof createMeter>>();

  const channel = (id: DeckId) => {
    const slider = (controlId: string, label: string, orient: 'vertical' | 'horizontal') => {
      const s = createSlider(registry, controlId, { label, orient });
      updaters.push(s.update);
      return s.el;
    };
    const meter = createMeter();
    meters.set(id, meter);
    return h(
      'div',
      { class: `channel channel-${id}` },
      h('h3', { text: `Ch ${id}` }),
      slider(`mixer.${id}.eq.high`, 'Hi', 'horizontal'),
      slider(`mixer.${id}.eq.mid`, 'Mid', 'horizontal'),
      slider(`mixer.${id}.eq.low`, 'Low', 'horizontal'),
      slider(`mixer.${id}.filter`, 'Filter', 'horizontal'),
      h('div', { class: 'fader-row' }, slider(`mixer.${id}.volume`, 'Vol', 'vertical'), meter.el),
    );
  };

  const crossfader = createSlider(registry, 'mixer.crossfader', {
    label: 'Crossfader',
    orient: 'horizontal',
    className: 'control-crossfader',
  });
  const master = createSlider(registry, 'mixer.master', { label: 'Master', orient: 'vertical' });
  updaters.push(crossfader.update, master.update);
  const masterMeter = createMeter();
  meters.set('master', masterMeter);

  const curve = h(
    'select',
    {
      attrs: { 'aria-label': 'クロスフェーダーカーブ' },
      on: {
        change: () => engine.mixer.setCurve(curve.value as CrossfaderCurve),
      },
    },
    h('option', { text: 'スムーズ', attrs: { value: 'smooth' } }),
    h('option', { text: 'シャープ', attrs: { value: 'sharp' } }),
    h('option', { text: 'リニア', attrs: { value: 'linear' } }),
  );

  const range = h(
    'select',
    {
      attrs: { 'aria-label': 'テンポレンジ' },
      on: {
        change: () => {
          engine.tempoRange = Number(range.value);
          for (const id of DECK_IDS) registry.dispatch(`deck.${id}.tempo`, registry.value(`deck.${id}.tempo`));
        },
      },
    },
    ...TEMPO_RANGES.map((r) =>
      h('option', { text: `±${r}%`, attrs: { value: String(r), ...(r === engine.tempoRange ? { selected: '' } : {}) } }),
    ),
  );

  const invert = h('input', {
    attrs: { type: 'checkbox', ...(engine.tempoInvert ? { checked: '' } : {}) },
    on: {
      change: () => {
        engine.tempoInvert = invert.checked;
        for (const id of DECK_IDS) registry.dispatch(`deck.${id}.tempo`, registry.value(`deck.${id}.tempo`));
      },
    },
  });

  const pickup = h('input', {
    attrs: { type: 'checkbox', ...(controller.pickupEnabled ? { checked: '' } : {}) },
    on: {
      change: () => {
        controller.pickupEnabled = pickup.checked;
      },
    },
  });

  const ledBox = h('input', {
    attrs: { type: 'checkbox', ...(led.enabled ? { checked: '' } : {}) },
    on: {
      change: () => {
        led.enabled = ledBox.checked;
      },
    },
  });

  const el = h(
    'section',
    { class: 'panel mixer' },
    h('header', {}, h('h2', { text: 'MIXER' })),
    h('div', { class: 'channels' }, channel('A'), h('div', { class: 'master' }, master.el, masterMeter.el), channel('B')),
    crossfader.el,
    h(
      'div',
      { class: 'mixer-options' },
      h('label', {}, 'カーブ ', curve),
      h('label', {}, 'テンポ ', range),
      h('label', {}, invert, ' 上が遅い'),
      h('label', { attrs: { title: '実機の値が画面の値に追いつくまで、反映を待つ' } }, pickup, ' ピックアップ'),
      h(
        'label',
        {
          attrs: {
            title: 'nanoKONTROL2 のボタン LED を点灯させる。KONTROL Editor で LED モードを External にしておく',
          },
        },
        ledBox,
        ' LED 出力',
      ),
    ),
  );

  const update = () => {
    for (const updater of updaters) updater();
    for (const id of DECK_IDS) meters.get(id)?.set(engine.mixer.channels[id].level());
    meters.get('master')?.set(engine.mixer.masterLevel());
  };

  return { el, update };
}
