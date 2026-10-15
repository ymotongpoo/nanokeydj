import type { Peaks } from '../audio/peaks';

export interface Colors {
  wave: string;
  dim: string;
  accent: string;
}

/** 実ピクセル数に合わせて canvas のバッファサイズを更新する。変わったら true。 */
export function fitCanvas(canvas: HTMLCanvasElement): boolean {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

/** 曲全体の波形。再生済みの部分を明るく描き、ループ範囲を重ねる。 */
export function drawOverview(
  canvas: HTMLCanvasElement,
  peaks: Peaks | null,
  progress: number,
  loop: { start: number; end: number } | null,
  duration: number,
  colors: Colors,
): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const { width, height } = canvas;
  g.clearRect(0, 0, width, height);
  if (!peaks) return;

  const mid = height / 2;
  const playedX = progress * width;
  for (let x = 0; x < width; x++) {
    const bucket = Math.min(peaks.buckets - 1, Math.floor((x / width) * peaks.buckets));
    const min = peaks.data[bucket * 2]!;
    const max = peaks.data[bucket * 2 + 1]!;
    g.fillStyle = x < playedX ? colors.dim : colors.wave;
    g.fillRect(x, mid - max * mid, 1, Math.max(1, (max - min) * mid));
  }

  if (loop && duration > 0) {
    g.fillStyle = `${colors.accent}55`;
    const x0 = (loop.start / duration) * width;
    g.fillRect(x0, 0, Math.max(2, ((loop.end - loop.start) / duration) * width), height);
  }
  g.fillStyle = '#ffffff';
  g.fillRect(playedX, 0, Math.max(1, width / 400), height);
}

export interface ZoomOptions {
  samples: Float32Array;
  sampleRate: number;
  position: number;
  /** 画面に収める秒数。 */
  windowSeconds: number;
  beatTimes?: number[];
  cues?: { time: number; label: string }[];
  loop?: { start: number; end: number } | null;
}

/** 再生位置を中央に固定して流れる、拡大した波形。 */
export function drawZoom(canvas: HTMLCanvasElement, options: ZoomOptions, colors: Colors): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const { width, height } = canvas;
  g.clearRect(0, 0, width, height);

  const { samples, sampleRate, position, windowSeconds } = options;
  const start = position - windowSeconds / 2;
  const secondsPerPixel = windowSeconds / width;
  const mid = height / 2;

  g.fillStyle = colors.wave;
  for (let x = 0; x < width; x++) {
    const t0 = start + x * secondsPerPixel;
    const i0 = Math.floor(t0 * sampleRate);
    const i1 = Math.floor((t0 + secondsPerPixel) * sampleRate);
    if (i1 < 0 || i0 >= samples.length) continue;
    const from = Math.max(0, i0);
    const to = Math.min(samples.length, Math.max(i1, from + 1));
    const stride = Math.max(1, Math.floor((to - from) / 24));
    let min = 0;
    let max = 0;
    for (let i = from; i < to; i += stride) {
      const v = samples[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    g.fillRect(x, mid - max * mid, 1, Math.max(1, (max - min) * mid));
  }

  const toX = (time: number) => ((time - start) / windowSeconds) * width;

  if (options.loop) {
    g.fillStyle = `${colors.accent}33`;
    const x0 = toX(options.loop.start);
    g.fillRect(x0, 0, toX(options.loop.end) - x0, height);
  }
  if (options.beatTimes) {
    g.fillStyle = '#ffffff55';
    for (const time of options.beatTimes) {
      if (time < start || time > start + windowSeconds) continue;
      g.fillRect(toX(time), 0, 1, height);
    }
  }
  if (options.cues) {
    g.font = `${Math.round(height * 0.16)}px system-ui`;
    for (const cue of options.cues) {
      if (cue.time < start || cue.time > start + windowSeconds) continue;
      const x = toX(cue.time);
      g.fillStyle = colors.accent;
      g.fillRect(x, 0, 2, height);
      g.fillText(cue.label, x + 4, height * 0.18);
    }
  }
  g.fillStyle = '#ffffff';
  g.fillRect(width / 2, 0, Math.max(1, width / 600), height);
}
