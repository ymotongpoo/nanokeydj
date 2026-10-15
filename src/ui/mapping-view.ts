import { describeSource } from '../control/bindings';
import type { Controller } from '../control/controller';
import { DEVICE_LABELS } from '../midi/devices';
import { h } from './dom';

/** コントロールと MIDI 入力の割り当てを一覧し、MIDI ラーンで書き換える。 */
export function createMappingView(controller: Controller): HTMLElement {
  const { registry, bindings, learner } = controller;
  const hint = h('p', { class: 'mapping-hint' });
  const list = h('div', { class: 'mapping-list' });

  const render = () => {
    const target = learner.target;
    hint.textContent = target
      ? `「${registry.get(target)?.label ?? target}」に割り当てる操作をコントローラーで行ってください（残り ${learner.remaining} 件）。`
      : '「学習」を押してから、割り当てたいつまみやボタンを操作します。';

    const groups = new Map<string, HTMLElement[]>();
    for (const def of registry.list()) {
      const sources = bindings
        .sourcesFor(def.id)
        .map((s) => `${DEVICE_LABELS[s.device]} ${describeSource(s)}`)
        .join('、');
      const row = h(
        'div',
        { class: `mapping-row${target === def.id ? ' mapping-row-active' : ''}` },
        h('span', { class: 'mapping-label', text: def.label }),
        h('span', { class: 'mapping-source', text: sources || '未割り当て' }),
        h('button', {
          text: target === def.id ? '取消' : '学習',
          on: {
            click: () => (target === def.id ? learner.cancel() : learner.start([def.id])),
          },
        }),
      );
      const rows = groups.get(def.group) ?? [];
      rows.push(row);
      groups.set(def.group, rows);
    }

    list.replaceChildren(
      ...[...groups].map(([group, rows]) =>
        h('div', { class: 'mapping-group' }, h('h3', { text: group }), ...rows),
      ),
    );
  };

  const padLearn = h('button', {
    text: 'ホットキューを順に学習',
    on: {
      click: () => {
        const ids = (['A', 'B'] as const).flatMap((deck) =>
          Array.from({ length: 8 }, (_, i) => `deck.${deck}.hotcue.${i + 1}`),
        );
        learner.start(ids);
      },
    },
  });
  const reset = h('button', {
    text: '初期値に戻す',
    on: {
      click: () => {
        learner.cancel();
        controller.resetToDefaults();
      },
    },
  });

  learner.onChange.on(render);
  controller.onBindingsChanged.on(render);
  render();

  return h(
    'details',
    { class: 'panel mapping' },
    h('summary', { text: 'MIDI 割り当て' }),
    h('div', { class: 'mapping-actions' }, padLearn, reset),
    hint,
    list,
  );
}
