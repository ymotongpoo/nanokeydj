import { detectBpm, type BpmResult } from './bpm';

export interface BpmRequest {
  id: number;
  samples: Float32Array;
  sampleRate: number;
}

export interface BpmResponse {
  id: number;
  result: BpmResult | null;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<BpmRequest>) => void) | null;
  postMessage(message: BpmResponse): void;
}

// 解析は数百ミリ秒かかることがあるので、MIDI の応答や描画を止めないようワーカーで走らせる。
const scope = self as unknown as WorkerScope;
scope.onmessage = (event) => {
  const { id, samples, sampleRate } = event.data;
  scope.postMessage({ id, result: detectBpm(samples, sampleRate) });
};
