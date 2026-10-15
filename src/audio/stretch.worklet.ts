import type { StretchMessage } from './stretch-protocol';
import { Wsola } from './wsola';

// AudioWorkletGlobalScope の型は DOM のライブラリに含まれないので、使うものだけ宣言する。
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void;

interface PendingStart {
  when: number;
  offset: number;
  rate: number;
  loop: { start: number; end: number } | null;
}

/** 曲のサンプルを預かり、指示された位置とレートから、音程を変えずに再生する。 */
class StretchProcessor extends AudioWorkletProcessor {
  private wsola = new Wsola();
  private pending: PendingStart | null = null;
  private playing = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<StretchMessage>) => this.onMessage(event.data);
  }

  private onMessage(message: StretchMessage): void {
    switch (message.type) {
      case 'load':
        this.playing = false;
        this.pending = null;
        this.wsola.setInput(message.channels);
        break;
      case 'unload':
        this.playing = false;
        this.pending = null;
        this.wsola.clearInput();
        break;
      case 'play':
        this.pending = {
          when: message.when,
          offset: message.offset,
          rate: message.rate,
          loop: message.loop,
        };
        this.playing = false;
        break;
      case 'stop':
        this.playing = false;
        this.pending = null;
        break;
      case 'rate':
        this.wsola.rate = message.rate;
        if (this.pending) this.pending.rate = message.rate;
        break;
      case 'loop':
        this.wsola.setLoop(message.loop && this.toSamples(message.loop));
        if (this.pending) this.pending.loop = message.loop;
        break;
    }
  }

  private toSamples(loop: { start: number; end: number }): { start: number; end: number } {
    return { start: loop.start * sampleRate, end: loop.end * sampleRate };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output) return true;

    if (this.pending && currentTime >= this.pending.when) {
      // メッセージが届くまでに進んだ分だけ、開始位置を先へ送る。メインスレッドの時計と揃う。
      const late = currentTime - this.pending.when;
      this.wsola.rate = this.pending.rate;
      this.wsola.start((this.pending.offset + late * this.pending.rate) * sampleRate);
      this.wsola.setLoop(this.pending.loop && this.toSamples(this.pending.loop));
      this.pending = null;
      this.playing = true;
    }

    if (!this.playing) {
      for (const channel of output) channel.fill(0);
      return true;
    }

    this.wsola.render(output, output[0]?.length ?? 128);
    if (this.wsola.ended) {
      this.playing = false;
      this.port.postMessage({ type: 'ended' });
    }
    return true;
  }
}

registerProcessor('nanokeydj-stretch', StretchProcessor);
