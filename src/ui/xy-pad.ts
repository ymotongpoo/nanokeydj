import type { ControlRegistry } from '../control/registry';
import { h } from './dom';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * マスターエフェクトの XY パッド。X が左右のフィルター、Y が上方向のエコーの量。
 * 押している間だけ効き、離すと素通しへ戻る（Kaoss 風）。
 * MIDI から値が来たときも、同じレジストリの値を見て点の位置を動かす。
 */
export function createXyPad(registry: ControlRegistry): { el: HTMLElement; update: () => void } {
  const dot = h('div', { class: 'xy-dot' });
  const pad = h(
    'div',
    { class: 'xy-pad', attrs: { role: 'application', 'aria-label': 'マスターエフェクト XY パッド' } },
    h('span', { class: 'xy-label xy-left', text: 'LPF' }),
    h('span', { class: 'xy-label xy-right', text: 'HPF' }),
    h('span', { class: 'xy-label xy-top', text: 'ECHO' }),
    dot,
  );

  let dragging = false;
  const move = (event: PointerEvent) => {
    const rect = pad.getBoundingClientRect();
    registry.dispatch('fx.x', clamp01((event.clientX - rect.left) / rect.width));
    registry.dispatch('fx.y', clamp01(1 - (event.clientY - rect.top) / rect.height));
  };
  const release = () => {
    if (!dragging) return;
    dragging = false;
    registry.dispatch('fx.reset', 1);
    registry.dispatch('fx.reset', 0);
  };
  pad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    try {
      pad.setPointerCapture(event.pointerId);
    } catch {
      // 無効なポインターでも、操作自体は続ける（キャプチャは指が枠の外へ出たときの保険）。
    }
    dragging = true;
    move(event);
  });
  pad.addEventListener('pointermove', (event) => {
    if (dragging) move(event);
  });
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);

  const update = () => {
    const x = registry.value('fx.x');
    const y = registry.value('fx.y');
    dot.style.left = `${x * 100}%`;
    dot.style.top = `${(1 - y) * 100}%`;
    pad.classList.toggle('active', Math.abs(x - 0.5) > 0.02 || y > 0.01);
  };
  return { el: h('div', { class: 'fx' }, h('div', { class: 'control-label', text: 'FX' }), pad), update };
}
