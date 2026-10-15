import './style.css';
import { analyzeBpm } from './audio/bpm-client';
import { Engine } from './audio/engine';
import { mixToMono } from './audio/peaks';
import { TrackStore } from './audio/track-store';
import { Controller } from './control/controller';
import { wireControls } from './control/wiring';
import { BpmCache, LibraryAnalyzer } from './library/analyzer';
import { Library } from './library/library';
import { MidiManager } from './midi/manager';
import { mountApp } from './ui/app';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app が見つかりません');

const midi = new MidiManager();
const controller = new Controller(midi);
const engine = new Engine();
const library = new Library();
// 追加された曲は、裏で順に解析して一覧に BPM を出し、曲ごとの保存にも書く。
new LibraryAnalyzer(library, {
  decode: async (file) => {
    const buffer = await engine.decode(await file.arrayBuffer());
    return { duration: buffer.duration, sampleRate: buffer.sampleRate, mono: mixToMono(buffer) };
  },
  analyze: analyzeBpm,
  store: new TrackStore(),
  cache: new BpmCache(),
});
wireControls(controller.registry, engine, library);

mountApp(root, engine, controller, midi, library);
void midi.start();

// 実機がなくても動作確認できるよう、開発用にコンソールから触れるようにする。
Object.assign(window, { nanokeydj: { midi, controller, engine, library } });
