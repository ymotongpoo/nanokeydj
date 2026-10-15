import type { Engine } from '../audio/engine';
import type { CrossfaderCurve } from '../audio/curves';
import type { CueRouting } from '../audio/mixer';
import { DECK_IDS, type DeckId } from '../control/controls';
import type { Controller } from '../control/controller';
import type { LedFeedback } from '../control/led';
import { MixRecorder, formatElapsed, recordingFileName } from '../audio/recorder';
import { bindButton, createSlider } from './controls';
import { h } from './dom';

const TEMPO_RANGES = [6, 8, 10, 16, 25, 50];
const ROUTING_STORAGE_KEY = 'nanokeydj.cue-routing';

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
  const cueButtons = new Map<DeckId, HTMLElement>();

  const channel = (id: DeckId) => {
    const slider = (controlId: string, label: string, orient: 'vertical' | 'horizontal') => {
      const s = createSlider(registry, controlId, { label, orient });
      updaters.push(s.update);
      return s.el;
    };
    const meter = createMeter();
    meters.set(id, meter);
    const cue = h('button', {
      class: 'btn-small btn-cue-send',
      text: 'CUE',
      attrs: { title: 'ヘッドホンでこのチャンネルを聴く（フェーダーの前の信号）' },
    });
    updaters.push(bindButton(cue, registry, `mixer.${id}.cue`));
    cueButtons.set(id, cue);
    return h(
      'div',
      { class: `channel channel-${id}` },
      h('div', { class: 'channel-head' }, h('h3', { text: `Ch ${id}` }), cue),
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

  const quantize = h('input', {
    attrs: { type: 'checkbox', ...(engine.quantize ? { checked: '' } : {}) },
    on: {
      change: () => {
        engine.quantize = quantize.checked;
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

  const headphoneVolume = createSlider(registry, 'mixer.headphone.volume', {
    label: 'HP 音量',
    orient: 'horizontal',
  });
  const headphoneMix = createSlider(registry, 'mixer.headphone.mix', {
    label: 'Cue ◀ ▶ Master',
    orient: 'horizontal',
  });
  updaters.push(headphoneVolume.update, headphoneMix.update);

  const routing = h(
    'select',
    {
      attrs: { 'aria-label': 'ヘッドホンの出し方' },
      on: {
        change: () => {
          engine.mixer.setRouting(routing.value as CueRouting);
          localStorage.setItem(ROUTING_STORAGE_KEY, engine.mixer.routing);
          routing.value = engine.mixer.routing;
        },
      },
    },
    h('option', { text: 'オフ（マスターのみ）', attrs: { value: 'off' } }),
    h('option', { text: '分割（左=マスター、右=ヘッドホン）', attrs: { value: 'split' } }),
    h('option', {
      text: '4ch（1-2=マスター、3-4=ヘッドホン）',
      attrs: { value: 'quad', ...(engine.mixer.quadAvailable ? {} : { disabled: '' }) },
    }),
  );
  const savedRouting = localStorage.getItem(ROUTING_STORAGE_KEY);
  if (savedRouting === 'split' || savedRouting === 'quad') engine.mixer.setRouting(savedRouting);
  routing.value = engine.mixer.routing;

  // 録音: マスター出力をファイルに保存する。録音の仕組みは、初めて押したときに用意する。
  let recorder: MixRecorder | null = null;
  const recStatus = h('span', { class: 'rec-status' });
  const recButton = h('button', {
    class: 'btn-small btn-rec',
    text: '● REC',
    attrs: { title: 'マスター出力を録音して保存する' },
    on: {
      click: () => {
        void toggleRecording();
      },
    },
  });
  const toggleRecording = async () => {
    await engine.resume();
    recorder ??= new MixRecorder(engine.mixer.recordingStream);
    if (!recorder.supported) {
      recStatus.textContent = 'このブラウザは録音に対応していません';
      return;
    }
    if (!recorder.recording) {
      recorder.start();
      return;
    }
    const blob = await recorder.stop();
    if (!blob || !recorder.format) return;
    const link = h('a', {
      attrs: {
        href: URL.createObjectURL(blob),
        download: recordingFileName(new Date(), recorder.format.extension),
      },
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  };

  const el = h(
    'section',
    { class: 'panel mixer' },
    h('header', {}, h('h2', { text: 'MIXER' }), h('div', { class: 'rec' }, recStatus, recButton)),
    h('div', { class: 'channels' }, channel('A'), h('div', { class: 'master' }, master.el, masterMeter.el), channel('B')),
    crossfader.el,
    h('div', { class: 'headphones' }, headphoneVolume.el, headphoneMix.el),
    h(
      'div',
      { class: 'mixer-options' },
      h('label', {}, 'ヘッドホン ', routing),
      h('label', {}, 'カーブ ', curve),
      h('label', {}, 'テンポ ', range),
      h('label', {}, invert, ' 上が遅い'),
      h(
        'label',
        { attrs: { title: 'Cue、ホットキュー、ループイン・アウトの位置を最寄りの拍に揃える' } },
        quantize,
        ' クオンタイズ',
      ),
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
    const recording = recorder?.recording ?? false;
    recButton.classList.toggle('recording', recording);
    recButton.textContent = recording ? '■ STOP' : '● REC';
    if (recording) recStatus.textContent = formatElapsed(recorder!.elapsed);
    else if (recorder?.supported !== false) recStatus.textContent = '';
    // CUE ボタンの点灯は、押している間ではなくチャンネルの Cue の入り切りを映す。
    for (const id of DECK_IDS) cueButtons.get(id)?.classList.toggle('active', engine.mixer.channels[id].cue);
    for (const id of DECK_IDS) meters.get(id)?.set(engine.mixer.channels[id].level());
    meters.get('master')?.set(engine.mixer.masterLevel());
  };

  return { el, update };
}
