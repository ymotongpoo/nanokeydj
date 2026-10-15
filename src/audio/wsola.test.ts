import { describe, expect, it } from 'vitest';
import { detectBpm } from './bpm';
import { renderDemoTrack } from './demo';
import { Wsola } from './wsola';

const SAMPLE_RATE = 44100;
const QUANTUM = 128;

function sine(frequency: number, seconds: number, gain = 1, sampleRate = SAMPLE_RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = gain * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return out;
}

/** AudioWorklet と同じく 128 サンプルずつ呼んで、frames サンプル分を集める。 */
function renderAll(wsola: Wsola, channels: number, frames: number): Float32Array[] {
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  const block = Array.from({ length: channels }, () => new Float32Array(QUANTUM));
  for (let done = 0; done < frames; done += QUANTUM) {
    const n = Math.min(QUANTUM, frames - done);
    wsola.render(block, n);
    for (let c = 0; c < channels; c++) out[c]!.set(block[c]!.subarray(0, n), done);
  }
  return out;
}

/** 上向きのゼロ交差から周波数を求める。 */
function estimateFrequency(samples: Float32Array, from: number, to: number, sampleRate = SAMPLE_RATE): number {
  const crossings: number[] = [];
  for (let i = Math.max(1, from); i < to; i++) {
    if (samples[i - 1]! < 0 && samples[i]! >= 0) {
      crossings.push(i - 1 + -samples[i - 1]! / (samples[i]! - samples[i - 1]!));
    }
  }
  if (crossings.length < 3) return 0;
  return ((crossings.length - 1) * sampleRate) / (crossings.at(-1)! - crossings[0]!);
}

describe('Wsola', () => {
  it('レート 1 では入力をそのまま再現する', () => {
    const input = sine(440, 3);
    for (let i = 0; i < input.length; i++) input[i]! += 0.3 * Math.sin(i * 0.0137 * i * 1e-4);
    const wsola = new Wsola();
    wsola.setInput([input]);
    wsola.start(10000);
    const [out] = renderAll(wsola, 1, 44100);
    let maxError = 0;
    for (let i = 0; i < out!.length; i++) maxError = Math.max(maxError, Math.abs(out![i]! - input[10000 + i]!));
    expect(maxError).toBeLessThan(1e-4);
  });

  it('始めた位置の入力がそのまま先頭から出る（フェードインしない）', () => {
    const input = sine(300, 2);
    const wsola = new Wsola();
    wsola.setInput([input]);
    wsola.start(5000);
    wsola.rate = 1.2;
    const [out] = renderAll(wsola, 1, 512);
    for (let i = 0; i < 512; i++) expect(out![i]).toBeCloseTo(input[5000 + i]!, 6);
  });

  it.each([0.8, 0.92, 1.08, 1.25, 1.5])('レート %f でも音程が変わらない', (rate) => {
    const input = sine(440, 8);
    const wsola = new Wsola();
    wsola.setInput([input]);
    wsola.start(0);
    wsola.rate = rate;
    const [out] = renderAll(wsola, 1, SAMPLE_RATE * 4);
    const frequency = estimateFrequency(out!, 8192, out!.length - 8192);
    expect(Math.abs(frequency - 440) / 440).toBeLessThan(0.005);
  });

  it('出力した分だけ、入力上の位置がレート倍で進む', () => {
    const input = sine(220, 10);
    const wsola = new Wsola();
    wsola.setInput([input]);
    wsola.start(1000);
    wsola.rate = 1.1;
    renderAll(wsola, 1, 44100);
    expect(wsola.position).toBeCloseTo(1000 + 44100 * 1.1, 0);
  });

  it('途中でレートを変えても位置が連続する', () => {
    const input = sine(220, 10);
    const wsola = new Wsola();
    wsola.setInput([input]);
    wsola.start(0);
    wsola.rate = 1;
    renderAll(wsola, 1, 22050);
    wsola.rate = 1.5;
    renderAll(wsola, 1, 22050);
    expect(wsola.position).toBeCloseTo(22050 + 22050 * 1.5, 0);
  });

  it('ステレオの左右比を保つ', () => {
    const left = sine(330, 4, 0.8);
    const right = sine(330, 4, 0.2);
    const wsola = new Wsola();
    wsola.setInput([left, right]);
    wsola.start(0);
    wsola.rate = 1.15;
    const [l, r] = renderAll(wsola, 2, SAMPLE_RATE);
    let peakL = 0;
    let peakR = 0;
    for (let i = 4096; i < l!.length - 4096; i++) {
      peakL = Math.max(peakL, Math.abs(l![i]!));
      peakR = Math.max(peakR, Math.abs(r![i]!));
    }
    expect(peakL / peakR).toBeCloseTo(4, 0);
  });

  it('モノラルの入力を複数チャンネルの出力へ複製する', () => {
    const wsola = new Wsola();
    wsola.setInput([sine(440, 2)]);
    wsola.start(0);
    const [a, b] = renderAll(wsola, 2, 4096);
    expect(a).toEqual(b);
  });

  it('入力が尽きると残りは無音になり、終了を知らせる', () => {
    const wsola = new Wsola();
    wsola.setInput([sine(440, 0.5)]);
    wsola.start(0);
    expect(wsola.ended).toBe(false);
    const [out] = renderAll(wsola, 1, SAMPLE_RATE * 2);
    expect(wsola.ended).toBe(true);
    for (let i = SAMPLE_RATE * 1.5; i < out!.length; i++) expect(out![i]).toBe(0);
  });

  it('入力がなければ無音を出す', () => {
    const wsola = new Wsola();
    const [out] = renderAll(wsola, 1, 1024);
    expect(out!.every((v) => v === 0)).toBe(true);
  });

  it('ループ範囲を何度も回り、継ぎ目で波形が飛ばない', () => {
    // 440 Hz をちょうど整数周期で切ったループにする。
    const period = SAMPLE_RATE / 440;
    const loopSamples = Math.round(period * 100);
    const input = sine(440, 6);
    const wsola = new Wsola();
    wsola.setInput([input]);
    wsola.start(10000);
    wsola.setLoop({ start: 10000, end: 10000 + loopSamples });
    wsola.rate = 1.1;
    const [out] = renderAll(wsola, 1, SAMPLE_RATE * 2);
    expect(wsola.position).toBeGreaterThanOrEqual(10000);
    expect(wsola.position).toBeLessThan(10000 + loopSamples);
    let maxStep = 0;
    for (let i = 1; i < out!.length; i++) maxStep = Math.max(maxStep, Math.abs(out![i]! - out![i - 1]!));
    // 440 Hz の正弦波の隣り合うサンプルの差は最大でも 2π·440/44100 ≈ 0.063。
    expect(maxStep).toBeLessThan(0.15);
    expect(Math.abs(estimateFrequency(out!, 8192, out!.length - 8192) - 440) / 440).toBeLessThan(0.01);
  });

  it('ループは再生中に外せる', () => {
    const wsola = new Wsola();
    wsola.setInput([sine(440, 6)]);
    wsola.start(10000);
    wsola.setLoop({ start: 10000, end: 12000 });
    renderAll(wsola, 1, SAMPLE_RATE);
    wsola.setLoop(null);
    renderAll(wsola, 1, SAMPLE_RATE);
    expect(wsola.position).toBeGreaterThan(40000);
  });

  it('テンポだけが変わり、拍の間隔がレート分縮む', () => {
    const rate = 1.08;
    const sampleRate = 22050;
    const [track] = renderDemoTrack(sampleRate, { bpm: 124, bars: 24, bass: [55, 65.41], leadIn: 0.15 });
    const wsola = new Wsola();
    wsola.setInput([track]);
    wsola.start(0);
    wsola.rate = rate;
    const frames = Math.floor(track.length / rate) - 4096;
    const [out] = renderAll(wsola, 1, frames);
    const result = detectBpm(out!, sampleRate);
    expect(result).not.toBeNull();
    expect(Math.abs(result!.bpm - 124 * rate)).toBeLessThan(0.5);
  });

  it('遅くしても同様にテンポが伸びる', () => {
    const rate = 0.92;
    const sampleRate = 22050;
    const [track] = renderDemoTrack(sampleRate, { bpm: 128, bars: 24, bass: [55], leadIn: 0.2 });
    const wsola = new Wsola();
    wsola.setInput([track]);
    wsola.start(0);
    wsola.rate = rate;
    const frames = Math.floor(track.length / rate) - 4096;
    const [out] = renderAll(wsola, 1, frames);
    const result = detectBpm(out!, sampleRate);
    expect(Math.abs(result!.bpm - 128 * rate)).toBeLessThan(0.5);
  });
});
