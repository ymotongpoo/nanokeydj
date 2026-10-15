import { detectBpm, type BpmResult } from './bpm';
import type { BpmRequest, BpmResponse } from './bpm.worker';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (result: BpmResult | null) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./bpm.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<BpmResponse>) => {
      pending.get(event.data.id)?.(event.data.result);
      pending.delete(event.data.id);
    };
  }
  return worker;
}

/** BPM と最初の拍をワーカーで解析する。ワーカーが使えない環境ではその場で解析する。 */
export function analyzeBpm(samples: Float32Array, sampleRate: number): Promise<BpmResult | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(detectBpm(samples, sampleRate));
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    const request: BpmRequest = { id, samples, sampleRate };
    getWorker().postMessage(request);
  });
}
