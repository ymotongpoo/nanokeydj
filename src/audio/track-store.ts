import type { KeyValueStorage } from '../control/controller';

export const TRACKS_STORAGE_KEY = 'nanokeydj.tracks.v1';
const MAX_ENTRIES = 300;

/** 曲ごとに覚えておく状態。ビートグリッドとキューの手直しを、次の読み込みに引き継ぐ。 */
export interface TrackState {
  bpm: number | null;
  firstBeat: number;
  cuePoint: number;
  hotcues: (number | null)[];
}

/** 同じ曲を同じ長さで読み込んだものを、同じ曲とみなすキー。 */
export function trackKey(name: string, duration: number): string {
  return `${name}|${Math.round(duration * 1000)}`;
}

function isTrackState(value: unknown): value is TrackState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.bpm === null || typeof v.bpm === 'number') &&
    typeof v.firstBeat === 'number' &&
    typeof v.cuePoint === 'number' &&
    Array.isArray(v.hotcues) &&
    v.hotcues.every((c) => c === null || typeof c === 'number')
  );
}

/** localStorage に曲ごとの状態を保存する。古いものから捨てて、件数を抑える。 */
export class TrackStore {
  constructor(private storage: KeyValueStorage | null = typeof localStorage === 'undefined' ? null : localStorage) {}

  get(key: string): TrackState | undefined {
    const entry = this.read()[key];
    return isTrackState(entry) ? entry : undefined;
  }

  set(key: string, state: TrackState): void {
    const all = this.read();
    // 更新した曲を末尾へ移し、先頭から捨てられるようにする。
    delete all[key];
    all[key] = state;
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[old];
    try {
      this.storage?.setItem(TRACKS_STORAGE_KEY, JSON.stringify(all));
    } catch {
      // 容量を超えたときは、保存を諦める。再生には影響しない。
    }
  }

  private read(): Record<string, unknown> {
    const raw = this.storage?.getItem(TRACKS_STORAGE_KEY);
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
