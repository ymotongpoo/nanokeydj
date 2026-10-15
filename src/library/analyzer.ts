import type { BpmResult } from '../audio/bpm';
import { HOTCUE_COUNT } from '../control/controls';
import type { KeyValueStorage } from '../control/controller';
import type { TrackStore } from '../audio/track-store';
import { trackKey } from '../audio/track-store';
import type { Library, LibraryEntry } from './library';

export const BPM_CACHE_STORAGE_KEY = 'nanokeydj.library-bpm.v1';
const MAX_CACHE_ENTRIES = 2000;

export interface CachedAnalysis {
  bpm: number | null;
  duration: number;
}

/** 同じファイルかを、読み込まずに判定するキー。 */
export function fileCacheKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** ファイルごとの解析結果。一覧に BPM をすぐ出すため、デコードせずに引けるようにしておく。 */
export class BpmCache {
  constructor(private storage: KeyValueStorage | null = typeof localStorage === 'undefined' ? null : localStorage) {}

  get(key: string): CachedAnalysis | undefined {
    const entry = this.read()[key];
    if (typeof entry !== 'object' || entry === null) return undefined;
    const v = entry as Record<string, unknown>;
    return (v.bpm === null || typeof v.bpm === 'number') && typeof v.duration === 'number'
      ? { bpm: v.bpm, duration: v.duration }
      : undefined;
  }

  set(key: string, value: CachedAnalysis): void {
    const all = this.read();
    delete all[key];
    all[key] = value;
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_CACHE_ENTRIES))) delete all[old];
    try {
      this.storage?.setItem(BPM_CACHE_STORAGE_KEY, JSON.stringify(all));
    } catch {
      // 容量を超えたら、保存を諦める。
    }
  }

  private read(): Record<string, unknown> {
    const raw = this.storage?.getItem(BPM_CACHE_STORAGE_KEY);
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

export interface AnalyzerDeps {
  /** ファイルを読んで、長さとモノラルのサンプルを返す。 */
  decode(file: File): Promise<{ duration: number; sampleRate: number; mono: Float32Array }>;
  analyze(mono: Float32Array, sampleRate: number): Promise<BpmResult | null>;
  store: TrackStore;
  cache: BpmCache;
}

/**
 * ライブラリに追加された曲を、裏で1曲ずつ解析する。
 * 結果は一覧に出すだけでなく、曲ごとの保存にも書く。デッキに載せたときに再解析せず、
 * 前に手直しした状態があれば、それを上書きしない。
 */
export class LibraryAnalyzer {
  private running = false;

  constructor(
    private library: Library,
    private deps: AnalyzerDeps,
  ) {
    library.onChange.on(() => void this.run());
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let entry = this.library.nextPending(); entry; entry = this.library.nextPending()) {
        await this.analyzeOne(entry);
      }
    } finally {
      this.running = false;
    }
  }

  private async analyzeOne(entry: LibraryEntry): Promise<void> {
    this.library.update(entry.id, { status: 'analyzing' });
    const key = fileCacheKey(entry.file);
    try {
      const cached = this.deps.cache.get(key);
      if (cached) {
        this.library.update(entry.id, { status: 'done', bpm: cached.bpm, duration: cached.duration });
        return;
      }
      const { duration, sampleRate, mono } = await this.deps.decode(entry.file);
      const result = await this.deps.analyze(mono, sampleRate);

      const track = trackKey(entry.name, duration);
      const saved = this.deps.store.get(track);
      // 前に手直しした状態があれば、それを尊重する。
      const bpm = saved?.bpm ?? result?.bpm ?? null;
      if (!saved && result) {
        this.deps.store.set(track, {
          bpm: result.bpm,
          firstBeat: result.firstBeat,
          cuePoint: result.firstBeat,
          hotcues: Array.from({ length: HOTCUE_COUNT }, () => null),
        });
      }
      this.deps.cache.set(key, { bpm, duration });
      this.library.update(entry.id, { status: 'done', bpm, duration });
    } catch {
      this.library.update(entry.id, { status: 'error' });
    }
  }
}
