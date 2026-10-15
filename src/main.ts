import './style.css';
import { Engine } from './audio/engine';
import { Controller } from './control/controller';
import { wireControls } from './control/wiring';
import { MidiManager } from './midi/manager';
import { mountApp } from './ui/app';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app が見つかりません');

const midi = new MidiManager();
const controller = new Controller(midi);
const engine = new Engine();
wireControls(controller.registry, engine);

mountApp(root, engine, controller, midi);
void midi.start();

// 実機がなくても動作確認できるよう、開発用にコンソールから触れるようにする。
Object.assign(window, { nanokeydj: { midi, controller, engine } });
