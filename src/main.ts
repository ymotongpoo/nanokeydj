import './style.css';
import { MidiManager } from './midi/manager';
import { h } from './ui/dom';
import { createMonitorView } from './ui/monitor-view';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app が見つかりません');

const midi = new MidiManager();

app.append(h('h1', { text: 'nanokeydj' }), createMonitorView(midi));

void midi.start();

// 実機がなくても動作確認できるよう、開発用にコンソールから MIDI を流せるようにする。
Object.assign(window, { nanokeydj: { midi } });
