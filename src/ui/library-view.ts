import type { Engine } from '../audio/engine';
import type { DeckId } from '../control/controls';
import { loadEntry } from '../library/loader';
import { Library, formatDuration, type LibraryEntry, type SortKey } from '../library/library';
import { h } from './dom';

const SORT_LABELS: Record<SortKey, string> = {
  added: '追加順',
  name: '名前順',
  bpm: 'BPM 順',
};

/** 読み込んだ曲の一覧。デッキへ載せ、BPM で並べ替える。 */
export function createLibraryView(engine: Engine, library: Library): HTMLElement {
  const status = h('span', { class: 'library-status' });
  const list = h('ol', { class: 'library-list' });
  let messageTimer: ReturnType<typeof setTimeout> | undefined;

  const addFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const added = library.add([...files]);
    flash(added > 0 ? `${added} 曲を追加しました` : '追加できる音声ファイルがありませんでした');
  };
  const flash = (text: string) => {
    status.textContent = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(render, 3000);
  };

  const fileInput = h('input', { attrs: { type: 'file', accept: 'audio/*', multiple: '', hidden: '' } });
  const folderInput = h('input', { attrs: { type: 'file', multiple: '', webkitdirectory: '', hidden: '' } });
  for (const input of [fileInput, folderInput]) {
    input.addEventListener('change', () => {
      addFiles(input.files);
      input.value = '';
    });
  }

  const sort = h(
    'select',
    {
      attrs: { 'aria-label': '並べ替え' },
      on: { change: () => (library.sort = sort.value as SortKey) },
    },
    ...(Object.keys(SORT_LABELS) as SortKey[]).map((key) =>
      h('option', { text: SORT_LABELS[key], attrs: { value: key } }),
    ),
  );

  const deckButton = (entry: LibraryEntry, deck: DeckId) =>
    h('button', {
      class: `btn-small btn-load btn-load-${deck}`,
      text: deck,
      attrs: { title: `Deck ${deck} に載せる` },
      on: {
        click: (event) => {
          event.stopPropagation();
          library.select(entry.id);
          if (!loadEntry(engine, library, entry, deck)) flash(`Deck ${deck} は再生中なので載せられません`);
        },
      },
    });

  const render = () => {
    const pending = library.pendingCount;
    status.textContent =
      library.size === 0 ? '' : pending > 0 ? `解析中（残り ${pending} 曲）` : `${library.size} 曲`;
    const selectedId = library.selected?.id;
    list.replaceChildren(
      ...library.list().map((entry) =>
        h(
          'li',
          {
            class: `library-row${entry.id === selectedId ? ' selected' : ''}`,
            on: { click: () => library.select(entry.id) },
          },
          h('span', { class: 'library-name', text: entry.name, attrs: { title: entry.file.name } }),
          h('span', {
            class: 'library-bpm',
            text:
              entry.status === 'error'
                ? 'エラー'
                : entry.status !== 'done'
                  ? '…'
                  : entry.bpm === null
                    ? '—'
                    : entry.bpm.toFixed(1),
          }),
          h('span', {
            class: 'library-duration',
            text: entry.duration === null ? '' : formatDuration(entry.duration),
          }),
          deckButton(entry, 'A'),
          deckButton(entry, 'B'),
        ),
      ),
    );
    list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  };
  library.onChange.on(render);
  render();

  const el = h(
    'section',
    { class: 'panel library' },
    h(
      'header',
      {},
      h('h2', { text: 'LIBRARY' }),
      h(
        'div',
        { class: 'library-tools' },
        status,
        h('label', {}, '並べ替え ', sort),
        h('button', { class: 'btn-small', text: '曲を追加', on: { click: () => fileInput.click() } }),
        h('button', { class: 'btn-small', text: 'フォルダを追加', on: { click: () => folderInput.click() } }),
        h('button', { class: 'btn-small', text: 'クリア', on: { click: () => library.clear() } }),
      ),
    ),
    list,
    fileInput,
    folderInput,
  );

  el.addEventListener('dragover', (event) => event.preventDefault());
  el.addEventListener('drop', (event) => {
    event.preventDefault();
    addFiles(event.dataTransfer?.files ?? null);
  });
  return el;
}
