import type { ControlRegistry } from '../control/registry';
import { h } from './dom';

/** range 入力をコントロールに結びつける。値は registry を正とし、操作中以外は registry に追従する。 */
export function bindRange(input: HTMLInputElement, registry: ControlRegistry, id: string): () => void {
  input.min = '0';
  input.max = '1';
  input.step = '0.001';
  input.addEventListener('input', () => registry.dispatch(id, Number(input.value)));
  return () => {
    if (document.activeElement !== input) input.value = String(registry.value(id));
  };
}

/** ボタンの押下と解放をコントロールに伝える。 */
export function bindButton(button: HTMLElement, registry: ControlRegistry, id: string): () => void {
  const release = () => {
    if (button.classList.contains('pressed')) {
      button.classList.remove('pressed');
      registry.dispatch(id, 0);
    }
  };
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    button.classList.add('pressed');
    registry.dispatch(id, 1);
  });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  return () => {
    button.classList.toggle('active', registry.value(id) > 0);
  };
}

export interface SliderOptions {
  label: string;
  orient: 'vertical' | 'horizontal';
  className?: string;
}

/** ラベル付きのスライダー。戻り値の update を毎フレーム呼ぶ。 */
export function createSlider(
  registry: ControlRegistry,
  id: string,
  options: SliderOptions,
): { el: HTMLElement; update: () => void } {
  const input = h('input', {
    class: `slider slider-${options.orient}`,
    attrs: { type: 'range', 'aria-label': options.label },
  });
  const update = bindRange(input, registry, id);
  const el = h(
    'label',
    { class: `control ${options.className ?? ''}` },
    h('span', { class: 'control-label', text: options.label }),
    input,
  );
  return { el, update };
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}
