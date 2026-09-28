import type { EditorView } from '@codemirror/view';

import { editorViewOf } from '../editor/current';
import { holdDropPoint, showDropPoint, takeDropPoint } from '../editor/drop-point';
import { splitPaths } from '../ipc/files';
import { linkDropped } from '../ipc/notes';
import { notify } from '../state/notices.svelte';
import { paneById } from '../state/panes.svelte';
import { languageOf, tabById } from '../state/tabs.svelte';
import { t, tn } from '../l10n';
import { openDropped } from './files';

/**
 * Файлы, брошенные в окно (задача 147).
 *
 * На текст заметки markdown — ссылками в место броска, как у Obsidian:
 * картинка вставкой, прочее ссылкой, файл извне — копией в папку вложений
 * (решает ядро, `link_dropped`). Куда угодно ещё — дерево, полосу вкладок,
 * код, картинку — открываются, как всегда. Папка в броске — тоже как всегда:
 * её открывают корнем, а не ссылаются на неё.
 *
 * Бросок из проводника ловит Tauri, а не вебвью: событие несёт точку
 * в пикселях экрана, и заметку под ней ищем сами.
 */

/** Точка окна в пикселях CSS. */
export interface Point {
  x: number;
  y: number;
}

interface NoteTarget {
  tabId: number;
  view: EditorView;
  /** Место в тексте под точкой. */
  pos: number;
}

/** Представление, над которым сейчас показана точка броска. */
let hovered: EditorView | null = null;

/** Номер броска: пока файлы копируются, их место держит редактор. */
let nextDrop = 1;

/** Заметка markdown под точкой окна. `null` — там не текст заметки. */
export function noteAt(point: Point): NoteTarget | null {
  const element = document.elementFromPoint(point.x, point.y);
  const editor = element?.closest<HTMLElement>('.cm-editor');
  const pane = element?.closest<HTMLElement>('[data-pane-id]');
  if (!editor || !pane) return null;

  const paneId = Number(pane.dataset.paneId);
  const view = editorViewOf(paneId);
  if (!view || view.dom !== editor || view.state.readOnly) return null;

  const tabId = paneById(paneId)?.active ?? null;
  const tab = tabId === null ? null : tabById(tabId);
  if (!tab || languageOf(tab)?.id !== 'markdown') return null;

  // Неточно, то есть ближайшее место, а не только буква под указателем:
  // бросок под последней строкой — это конец заметки.
  return { tabId: tab.meta.id, view, pos: view.posAtCoords(point, false) };
}

/** Файл тянут над окном: показать, куда ляжет ссылка. */
export function dragOver(point: Point): void {
  const target = noteAt(point);
  if (hovered && hovered !== target?.view) showDropPoint(hovered, null);
  hovered = target?.view ?? null;
  if (target) showDropPoint(target.view, target.pos);
}

/** Файл увели из окна или бросили. */
export function dragLeave(): void {
  if (hovered) showDropPoint(hovered, null);
  hovered = null;
}

export async function dropFiles(paths: string[], point: Point): Promise<void> {
  dragLeave();
  const target = noteAt(point);
  if (!target) {
    await openDropped(paths);
    return;
  }

  const { files, folders } = await splitPaths(paths);
  if (folders.length > 0 || files.length === 0) {
    await openDropped(paths);
    return;
  }

  const note = tabById(target.tabId)?.meta.path ?? null;
  if (note === null) {
    notify(t('drop.unsaved'));
    return;
  }

  // Место держит редактор: копия большого файла идёт секунды, и правки
  // за это время сдвигают текст.
  const id = nextDrop++;
  holdDropPoint(target.view, id, target.pos);
  let dropped;
  try {
    dropped = await linkDropped(note, files);
  } catch (error) {
    takeDropPoint(target.view, id);
    notify(t('drop.failed', { error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  const at = target.view.dom.isConnected ? takeDropPoint(target.view, id) : null;

  const links = dropped.flatMap((item) => (item.link === null ? [] : [item.link]));
  const errors = dropped.flatMap((item) => (item.error === null ? [] : [item.error]));

  if (links.length > 0) {
    if (at === null) {
      notify(t('drop.closed'));
    } else {
      // Через пустую строку, как у Obsidian: картинки встают каждая
      // своим абзацем.
      const text = links.join('\n\n');
      target.view.dispatch({
        changes: { from: at, insert: text },
        selection: { anchor: at + text.length },
        scrollIntoView: true,
        userEvent: 'input.drop',
      });
      target.view.focus();
    }
  }

  if (errors.length === 1) {
    notify(t('drop.file.failed', { error: errors[0]! }));
  } else if (errors.length > 1) {
    notify(tn('drop.files.failed', errors.length, { error: errors[0]! }));
  }
}
