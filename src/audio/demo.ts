export interface DemoOptions {
  bpm: number;
  bars: number;
  /** 8 分音符ごとに順に鳴らすベースの周波数（Hz）。 */
  bass: number[];
  /** 曲頭の無音の長さ（秒）。最初の拍がこの位置に来る。 */
  leadIn: number;
}

export const DEMO_TRACKS: Record<'A' | 'B', DemoOptions & { name: string }> = {
  A: { name: 'Demo 124 BPM', bpm: 124, bars: 32, bass: [55, 55, 65.41, 55, 49, 49, 61.74, 49], leadIn: 0.15 },
  B: { name: 'Demo 128 BPM', bpm: 128, bars: 32, bass: [58.27, 58.27, 58.27, 69.3, 51.91, 51.91, 65.41, 51.91], leadIn: 0.32 },
};

/** 外部ファイルなしで動作確認できる 4 つ打ちのデモ曲を、左右のサンプル列として作る。 */
export function renderDemoTrack(sampleRate: number, options: DemoOptions): [Float32Array, Float32Array] {
  const beat = 60 / options.bpm;
  const totalSeconds = options.leadIn + options.bars * 4 * beat + 0.5;
  const length = Math.ceil(totalSeconds * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let seed = 12345;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  };

  const add = (start: number, samples: Float32Array, gainL: number, gainR: number) => {
    const offset = Math.round(start * sampleRate);
    for (let i = 0; i < samples.length && offset + i < length; i++) {
      left[offset + i]! += samples[i]! * gainL;
      right[offset + i]! += samples[i]! * gainR;
    }
  };

  const kick = (() => {
    const out = new Float32Array(Math.round(0.35 * sampleRate));
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sampleRate;
      phase += (2 * Math.PI * (45 + 105 * Math.exp(-t * 35))) / sampleRate;
      out[i] = Math.sin(phase) * Math.exp(-t * 9) * 0.9;
    }
    return out;
  })();

  const hat = (() => {
    const out = new Float32Array(Math.round(0.06 * sampleRate));
    let previous = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sampleRate;
      const n = noise();
      out[i] = (n - previous) * Math.exp(-t * 60) * 0.25;
      previous = n;
    }
    return out;
  })();

  const clap = (() => {
    const out = new Float32Array(Math.round(0.2 * sampleRate));
    for (let i = 0; i < out.length; i++) {
      const t = i / sampleRate;
      out[i] = noise() * Math.exp(-t * 25) * 0.35;
    }
    return out;
  })();

  const bassNote = (hz: number) => {
    const out = new Float32Array(Math.round(0.2 * sampleRate));
    for (let i = 0; i < out.length; i++) {
      const t = i / sampleRate;
      out[i] = Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * 8) * 0.35;
    }
    return out;
  };
  const bassNotes = options.bass.map(bassNote);

  for (let bar = 0; bar < options.bars; bar++) {
    for (let step = 0; step < 4; step++) {
      const beatStart = options.leadIn + (bar * 4 + step) * beat;
      add(beatStart, kick, 1, 1);
      add(beatStart + beat / 2, hat, 0.8, 1.2);
      if (step % 2 === 1) add(beatStart, clap, 1, 1);
      const note = bassNotes[(step * 2) % bassNotes.length]!;
      const offbeat = bassNotes[(step * 2 + 1) % bassNotes.length]!;
      add(beatStart + beat / 2, offbeat, 1, 1);
      add(beatStart + beat / 4, note, 0.6, 0.6);
    }
  }

  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  const scale = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < length; i++) {
    left[i]! *= scale;
    right[i]! *= scale;
  }
  return [left, right];
}

export function createDemoBuffer(ctx: BaseAudioContext, options: DemoOptions): AudioBuffer {
  const [left, right] = renderDemoTrack(ctx.sampleRate, options);
  const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
  buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  return buffer;
}
