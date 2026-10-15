import { createDemoBuffer, DEMO_TRACKS } from '../audio/demo';
import type { Engine } from '../audio/engine';
import { beatTimesIn } from '../audio/beatgrid';
import { computePeaks, mixToMono, type Peaks } from '../audio/peaks';
import { HOTCUE_COUNT, LOOP_BEATS, type DeckId } from '../control/controls';
import type { ControlRegistry } from '../control/registry';
import { bindButton, createSlider, formatTime } from './controls';
import { h } from './dom';
import { drawOverview, drawZoom, fitCanvas, type Colors } from './waveform';

const ZOOM_SECONDS = 6;

const COLORS: Record<DeckId, Colors> = {
  A: { wave: '#35b6ff', dim: '#1b5a80', accent: '#35b6ff' },
  B: { wave: '#ff6b9a', dim: '#80354d', accent: '#ff6b9a' },
};

export interface DeckView {
  el: HTMLElement;
  update(): void;
}

export function createDeckView(engine: Engine, registry: ControlRegistry, id: DeckId): DeckView {
  const deck = engine.decks[id];
  const colors = COLORS[id];

  let peaks: Peaks | null = null;
  let mono: Float32Array | null = null;
  let analyzed: AudioBuffer | null = null;

  const title = h('span', { class: 'deck-title', text: `Deck ${id}` });
  const trackName = h('span', { class: 'deck-track', text: '曲が読み込まれていません' });
  const tempoText = h('span', { class: 'deck-tempo', text: '+0.0%' });
  const bpmText = h('span', { class: 'deck-bpm', text: 'BPM —' });
  const halve = h('button', {
    class: 'btn-small',
    text: '½',
    attrs: { title: 'BPM を半分にする' },
    on: { click: () => deck.bpm !== null && deck.setBpm(deck.bpm / 2) },
  });
  const double = h('button', {
    class: 'btn-small',
    text: '×2',
    attrs: { title: 'BPM を倍にする' },
    on: { click: () => deck.bpm !== null && deck.setBpm(deck.bpm * 2) },
  });
  const status = h('span', { class: 'deck-status' });

  const zoom = h('canvas', { class: 'wave-zoom' });
  const overview = h('canvas', { class: 'wave-overview' });
  const elapsed = h('span', { class: 'time', text: '0:00.0' });
  const remaining = h('span', { class: 'time time-remaining', text: '-0:00.0' });

  const play = h('button', { class: 'btn-play', text: '▶ Play' });
  const cue = h('button', { class: 'btn-cue', text: 'Cue' });
  const sync = h('button', { class: 'btn-sync', text: 'Sync' });

  const updaters: (() => void)[] = [
    bindButton(play, registry, `deck.${id}.play`),
    bindButton(cue, registry, `deck.${id}.cue`),
    bindButton(sync, registry, `deck.${id}.sync`),
  ];
  const tempo = createSlider(registry, `deck.${id}.tempo`, {
    label: 'Tempo',
    orient: 'vertical',
    className: 'control-tempo',
  });
  updaters.push(tempo.update);

  const hotcueButtons = Array.from({ length: HOTCUE_COUNT }, (_, i) => {
    const button = h('button', {
      class: 'btn-hotcue',
      text: String(i + 1),
      attrs: { title: 'クリックで打つ／飛ぶ。右クリックで削除' },
    });
    updaters.push(bindButton(button, registry, `deck.${id}.hotcue.${i + 1}`));
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      deck.clearHotcue(i);
    });
    return button;
  });

  const loopButtons = LOOP_BEATS.map((beats) => {
    const button = h('button', {
      class: 'btn-loop',
      text: beats === 0.5 ? '½' : String(beats),
      attrs: { title: `${beats} 拍のループ` },
      on: { click: () => deck.beatLoop(beats) },
    });
    return { beats, button };
  });
  const loopIn = h('button', {
    class: 'btn-loop',
    text: 'In',
    attrs: { title: 'ループイン（始点）' },
    on: { click: () => deck.loopIn() },
  });
  const loopOut = h('button', {
    class: 'btn-loop',
    text: 'Out',
    attrs: { title: 'ループアウト（終点）' },
    on: { click: () => deck.loopOut() },
  });
  const loopExit = h('button', {
    class: 'btn-loop',
    text: 'Exit',
    on: { click: () => deck.exitLoop() },
  });

  const fileInput = h('input', { attrs: { type: 'file', accept: 'audio/*', hidden: '' } });
  const loadFile = async (file: File) => {
    status.textContent = '読み込み中…';
    try {
      await engine.resume();
      await engine.loadFile(id, file);
      status.textContent = '';
    } catch (error) {
      status.textContent = `読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void loadFile(file);
    fileInput.value = '';
  });
  const loadButton = h('button', { text: '曲を読み込む', on: { click: () => fileInput.click() } });
  const demoButton = h('button', {
    text: 'デモ曲',
    on: {
      click: () => {
        void engine.resume();
        engine.loadBuffer(id, createDemoBuffer(engine.ctx, DEMO_TRACKS[id]), DEMO_TRACKS[id].name);
      },
    },
  });

  overview.addEventListener('pointerdown', (event) => {
    if (!deck.loaded) return;
    const rect = overview.getBoundingClientRect();
    deck.seek(((event.clientX - rect.left) / rect.width) * deck.duration);
  });

  const el = h(
    'section',
    { class: `panel deck deck-${id}` },
    h('header', {}, h('div', { class: 'deck-heading' }, title, trackName), h('div', { class: 'deck-numbers' }, bpmText, halve, double, tempoText)),
    h('div', { class: 'deck-main' },
      h('div', { class: 'deck-waves' }, zoom, overview, h('div', { class: 'time-row' }, elapsed, remaining)),
      tempo.el,
    ),
    h('div', { class: 'transport' }, play, cue, sync),
    h('div', { class: 'hotcue-row' }, ...hotcueButtons),
    h('div', { class: 'loop-row' }, ...loopButtons.map((l) => l.button), loopIn, loopOut, loopExit),
    h('div', { class: 'load-row' }, loadButton, demoButton, status, fileInput),
  );

  el.addEventListener('dragover', (event) => event.preventDefault());
  el.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) void loadFile(file);
  });

  const refreshAnalysis = () => {
    const buffer = deck.audio;
    if (buffer === analyzed) return;
    analyzed = buffer;
    if (!buffer) {
      peaks = null;
      mono = null;
      trackName.textContent = '曲が読み込まれていません';
      return;
    }
    mono = mixToMono(buffer);
    peaks = computePeaks(mono, 1200);
    trackName.textContent = deck.name;
  };

  const update = () => {
    refreshAnalysis();
    for (const updater of updaters) updater();

    const snapshot = deck.snapshot();
    el.classList.toggle('focused', engine.focused === id);
    play.textContent = snapshot.playing ? '❚❚ Pause' : '▶ Play';
    tempoText.textContent = `${snapshot.rate >= 1 ? '+' : ''}${((snapshot.rate - 1) * 100).toFixed(1)}%`;
    bpmText.textContent = snapshot.analyzing
      ? 'BPM 解析中…'
      : snapshot.bpm === null
        ? 'BPM —'
        : `BPM ${(snapshot.bpm * snapshot.rate).toFixed(1)}`;
    elapsed.textContent = formatTime(snapshot.position);
    remaining.textContent = `-${formatTime(snapshot.duration - snapshot.position)}`;

    hotcueButtons.forEach((button, i) => {
      const time = snapshot.hotcues[i];
      button.classList.toggle('set', time !== null && time !== undefined);
    });
    loopIn.classList.toggle('active', snapshot.loopInPoint !== null);
    for (const { beats, button } of loopButtons) {
      const active =
        snapshot.loop !== null &&
        snapshot.bpm !== null &&
        Math.abs(snapshot.loop.end - snapshot.loop.start - (beats * 60) / snapshot.bpm) < 1e-6;
      button.classList.toggle('active', active);
    }

    fitCanvas(zoom);
    fitCanvas(overview);
    if (mono) {
      drawZoom(
        zoom,
        {
          samples: mono,
          sampleRate: deck.audio!.sampleRate,
          position: snapshot.position,
          windowSeconds: ZOOM_SECONDS,
          loop: snapshot.loop,
          cues: [
            { time: snapshot.cuePoint, label: 'C' },
            ...(snapshot.loopInPoint === null ? [] : [{ time: snapshot.loopInPoint, label: 'IN' }]),
            ...snapshot.hotcues.flatMap((time, i) =>
              time === null ? [] : [{ time, label: String(i + 1) }],
            ),
          ],
          beatTimes:
            snapshot.bpm === null
              ? undefined
              : beatTimesIn(
                  snapshot.firstBeat,
                  snapshot.bpm,
                  snapshot.position - ZOOM_SECONDS / 2,
                  snapshot.position + ZOOM_SECONDS / 2,
                ),
        },
        colors,
      );
    } else {
      zoom.getContext('2d')?.clearRect(0, 0, zoom.width, zoom.height);
    }
    drawOverview(
      overview,
      peaks,
      snapshot.duration > 0 ? snapshot.position / snapshot.duration : 0,
      snapshot.loop,
      snapshot.duration,
      colors,
    );
  };

  return { el, update };
}
