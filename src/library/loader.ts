import type { Engine } from '../audio/engine';
import type { DeckId } from '../control/controls';
import type { Library, LibraryEntry } from './library';

/**
 * ライブラリの曲をデッキへ載せる。
 * 再生中のデッキには載せない（本番で、鳴っている曲を誤って消さないため）。
 * 載せられたら true。
 */
export function loadEntry(engine: Engine, library: Library, entry: LibraryEntry, deck: DeckId): boolean {
  if (engine.decks[deck].playing) return false;
  void engine.resume();
  engine.loadFile(deck, entry.file).catch(() => library.update(entry.id, { status: 'error' }));
  return true;
}

/** 選択中の曲をデッキへ載せる。 */
export function loadSelected(engine: Engine, library: Library, deck: DeckId): boolean {
  const entry = library.selected;
  return entry ? loadEntry(engine, library, entry, deck) : false;
}
