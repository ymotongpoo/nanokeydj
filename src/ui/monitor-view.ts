import { DEVICE_LABELS, type DeviceKind } from '../midi/devices';
import type { MidiManager, MidiPortInfo, MidiStatus } from '../midi/manager';
import { describeMessage } from '../midi/parse';
import { h } from './dom';

const MAX_LINES = 200;
const KNOWN_DEVICES: DeviceKind[] = ['nanokontrol2', 'nanopad2', 'nanokey2'];

const STATUS_TEXT: Record<MidiStatus, string> = {
  idle: 'MIDI 待機中',
  unsupported: 'このブラウザは Web MIDI に対応していません。Chrome か Edge を使ってください。',
  denied: 'MIDI の使用が許可されませんでした。ブラウザの設定で許可してください。',
  ready: 'MIDI 利用可能',
};

/** 接続状況と受信メッセージのログを表示する。 */
export function createMonitorView(midi: MidiManager): HTMLElement {
  const status = h('p', { class: 'monitor-status', text: STATUS_TEXT[midi.status] });
  const chips = h('div', { class: 'device-chips' });
  const log = h('ol', { class: 'monitor-log' });
  let paused = false;

  const pauseButton = h('button', {
    text: '一時停止',
    on: {
      click: () => {
        paused = !paused;
        pauseButton.textContent = paused ? '再開' : '一時停止';
      },
    },
  });
  const clearButton = h('button', {
    text: 'クリア',
    on: { click: () => log.replaceChildren() },
  });

  const renderPorts = (ports: MidiPortInfo[]) => {
    const connected = (kind: DeviceKind) => ports.some((p) => p.device === kind && p.connected);
    chips.replaceChildren(
      ...KNOWN_DEVICES.map((kind) =>
        h('span', {
          class: `chip ${connected(kind) ? 'chip-on' : 'chip-off'}`,
          text: `${DEVICE_LABELS[kind]} ${connected(kind) ? '接続中' : '未接続'}`,
        }),
      ),
    );
    const others = ports.filter((p) => p.device === 'unknown' && p.connected);
    for (const port of others) {
      chips.append(h('span', { class: 'chip chip-other', text: port.name }));
    }
  };
  renderPorts(midi.ports());

  midi.onStatusChanged.on((s) => {
    status.textContent = STATUS_TEXT[s];
  });
  midi.onPortsChanged.on(renderPorts);
  midi.onMessage.on((event) => {
    if (paused) return;
    const time = (event.timeStamp / 1000).toFixed(3);
    const line = h(
      'li',
      {},
      h('span', { class: 'log-time', text: time }),
      h('span', { class: 'log-device', text: DEVICE_LABELS[event.device] }),
      h('span', { class: 'log-body', text: describeMessage(event.message) }),
    );
    log.prepend(line);
    while (log.childElementCount > MAX_LINES) log.lastElementChild?.remove();
  });

  return h(
    'section',
    { class: 'panel monitor' },
    h('header', {}, h('h2', { text: 'MIDI モニター' }), h('div', {}, pauseButton, clearButton)),
    status,
    chips,
    log,
  );
}
