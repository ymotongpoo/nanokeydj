import type { LoopRegion } from './clock';
import type { StretchEvent, StretchMessage } from './stretch-protocol';
import workletUrl from './stretch.worklet.ts?worker&url';

/** Deck が時間伸縮の再生に使う窓口。テストでは差し替える。 */
export interface Stretcher {
  readonly output: AudioNode;
  onEnded: (() => void) | null;
  /** 曲のサンプルを渡す。呼び出し側のデータは変更しない（コピーして渡す）。 */
  load(channels: Float32Array[]): void;
  unload(): void;
  play(when: number, offset: number, rate: number, loop: LoopRegion | null): void;
  stop(): void;
  setRate(rate: number): void;
  setLoop(loop: LoopRegion | null): void;
}

const registered = new WeakSet<BaseAudioContext>();

/** AudioWorklet 上の WSOLA を操作する。 */
export class StretchPlayer implements Stretcher {
  onEnded: (() => void) | null = null;
  private node: AudioWorkletNode;

  /** ワークレットのモジュールを読み込む。1 つの AudioContext につき 1 回でよい。 */
  static async register(ctx: AudioContext): Promise<void> {
    if (registered.has(ctx)) return;
    await ctx.audioWorklet.addModule(workletUrl);
    registered.add(ctx);
  }

  constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, 'nanokeydj-stretch', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.port.onmessage = (event: MessageEvent<StretchEvent>) => {
      if (event.data.type === 'ended') this.onEnded?.();
    };
  }

  get output(): AudioNode {
    return this.node;
  }

  load(channels: Float32Array[]): void {
    // ワークレットへ移すので、元のバッファを壊さないようコピーを渡す。
    const copies = channels.map((c) => c.slice());
    this.post({ type: 'load', channels: copies }, copies.map((c) => c.buffer));
  }

  unload(): void {
    this.post({ type: 'unload' });
  }

  play(when: number, offset: number, rate: number, loop: LoopRegion | null): void {
    this.post({ type: 'play', when, offset, rate, loop });
  }

  stop(): void {
    this.post({ type: 'stop' });
  }

  setRate(rate: number): void {
    this.post({ type: 'rate', rate });
  }

  setLoop(loop: LoopRegion | null): void {
    this.post({ type: 'loop', loop });
  }

  private post(message: StretchMessage, transfer: Transferable[] = []): void {
    this.node.port.postMessage(message, transfer);
  }
}
