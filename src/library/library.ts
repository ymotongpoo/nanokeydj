import { Emitter } from '../util/emitter';

export type SortKey = 'added' | 'name' | 'bpm';
export type AnalysisStatus = 'pending' | 'analyzing' | 'done' | 'error';

export interface LibraryEntry {
  id: number;
  file: File;
  /** 一覧とデッキに出す名前。拡張子を除いたファイル名。 */
  name: string;
  status: AnalysisStatus;
  bpm: number | null;
  duration: number | null;
}

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'flac',
  'ogg',
  'oga',
  'opus',
  'm4a',
  'aac',
  'aif',
  'aiff',
  'webm',
]);

/** 拡張子を除いたファイル名。デッキの曲名と、曲ごとの保存のキーに使う。 */
export function displayName(file: { name: string }): string {
  return file.name.replace(/\.[^.]+$/, '');
}

/** 長さの表示。例: 3:05 */
export function formatDuration(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function isAudioFile(file: { name: string; type: string }): boolean {
  if (file.type.startsWith('audio/')) return true;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.has(extension);
}

const sameFile = (a: File, b: File) =>
  a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/** 読み込んだ音声ファイルの一覧。並べ替えと選択を持つ。 */
export class Library {
  readonly onChange = new Emitter<void>();

  private entries: LibraryEntry[] = [];
  private nextId = 1;
  private _sort: SortKey = 'added';
  private _selectedId: number | null = null;

  get sort(): SortKey {
    return this._sort;
  }

  set sort(key: SortKey) {
    this._sort = key;
    this.onChange.emit();
  }

  /** 音声ファイルだけを、重複を除いて追加する。追加した件数を返す。 */
  add(files: File[]): number {
    let added = 0;
    for (const file of files) {
      if (!isAudioFile(file) || this.entries.some((e) => sameFile(e.file, file))) continue;
      this.entries.push({
        id: this.nextId++,
        file,
        name: displayName(file),
        status: 'pending',
        bpm: null,
        duration: null,
      });
      added++;
    }
    if (added > 0) {
      if (this._selectedId === null) this._selectedId = this.list()[0]?.id ?? null;
      this.onChange.emit();
    }
    return added;
  }

  /** 並べ替えた一覧。BPM 順では、BPM が分からない曲を最後に置く。 */
  list(): LibraryEntry[] {
    const entries = [...this.entries];
    switch (this._sort) {
      case 'name':
        return entries.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
      case 'bpm':
        return entries.sort((a, b) => {
          if (a.bpm === null && b.bpm === null) return a.id - b.id;
          if (a.bpm === null) return 1;
          if (b.bpm === null) return -1;
          return a.bpm - b.bpm || a.id - b.id;
        });
      case 'added':
        return entries;
    }
  }

  get size(): number {
    return this.entries.length;
  }

  get selected(): LibraryEntry | null {
    return this.entries.find((e) => e.id === this._selectedId) ?? null;
  }

  select(id: number): void {
    if (this._selectedId === id || !this.entries.some((e) => e.id === id)) return;
    this._selectedId = id;
    this.onChange.emit();
  }

  /** 選択を一覧の上下へ動かす。端では止まる。 */
  move(delta: number): void {
    const list = this.list();
    if (list.length === 0) return;
    const index = list.findIndex((e) => e.id === this._selectedId);
    const next = Math.min(list.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
    this.select(list[next]!.id);
  }

  clear(): void {
    this.entries = [];
    this._selectedId = null;
    this.onChange.emit();
  }

  /** 解析の経過と結果を書き込む。 */
  update(id: number, patch: Partial<Pick<LibraryEntry, 'status' | 'bpm' | 'duration'>>): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    Object.assign(entry, patch);
    this.onChange.emit();
  }

  /** 解析を待っている最初の曲。 */
  nextPending(): LibraryEntry | null {
    return this.entries.find((e) => e.status === 'pending') ?? null;
  }

  get pendingCount(): number {
    return this.entries.filter((e) => e.status === 'pending' || e.status === 'analyzing').length;
  }
}
