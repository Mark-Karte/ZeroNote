import type { EditorView } from '@codemirror/view';
import { editorView } from '../editor/current';
import * as engine from '../editor/search';

/**
 * Состояние панели поиска.
 *
 * Панель одна на окно и не привязана к вкладке: так ведёт себя Notepad++,
 * и это удобнее — запрос переживает переключение файлов.
 */

export type SearchMode = 'find' | 'replace';

export const search = $state({
  open: false,
  mode: 'find' as SearchMode,
  term: '',
  replacement: '',
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  matches: { total: 0, current: 0, invalid: false } as engine.Matches,
  /** Панель просит поле ввода забрать фокус. Сбрасывается самим полем. */
  focusRequest: 0,
});

function query(): engine.Query {
  return {
    term: search.term,
    replacement: search.replacement,
    caseSensitive: search.caseSensitive,
    wholeWord: search.wholeWord,
    regexp: search.regexp,
  };
}

/**
 * Пересчёт счётчика идёт с задержкой.
 *
 * Обход всего документа на каждое нажатие клавиши на файле в десять
 * мегабайт заметен на глаз; сам поиск при этом остаётся мгновенным,
 * потому что подсветку и переходы делает CodeMirror по своему индексу.
 */
let recountTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRecount(): void {
  if (recountTimer !== null) clearTimeout(recountTimer);
  recountTimer = setTimeout(() => {
    recountTimer = null;
    const view = editorView();
    search.matches = view
      ? engine.count(view, query())
      : { total: 0, current: 0, invalid: false };
  }, 150);
}

/**
 * Где сейчас стоят подсветки.
 *
 * Панель одна на окно и стоит над активной областью (Р-210); когда фокус
 * уходит в соседнюю, запрос переезжает вместе с ней, а с прежнего
 * представления подсветки снимаются — иначе две области подсвечивали бы
 * одно и то же, и только в одной из них работали бы переходы.
 */
let applied: EditorView | null = null;

/** Запрос изменился или сменилась область: сообщить редактору и пересчитать. */
export function syncQuery(): void {
  const view = editorView();
  if (applied && applied !== view) {
    engine.apply(applied, { ...query(), term: '' });
  }
  if (view) engine.apply(view, query());
  applied = view;
  scheduleRecount();
}

export function openSearch(mode: SearchMode): void {
  const view = editorView();

  // Выделение переносится в поле поиска: искать выделенное — самый частый
  // сценарий, и заставлять набирать его заново незачем.
  if (view) {
    const range = view.state.selection.main;
    if (!range.empty && range.to - range.from < 200) {
      const selected = view.state.doc.sliceString(range.from, range.to);
      // Только однострочное: многострочное выделение в поле поиска
      // превратилось бы в кашу.
      if (!selected.includes('\n')) search.term = selected;
    }
  }

  search.open = true;
  search.mode = mode;
  search.focusRequest += 1;
  syncQuery();
}

export function closeSearch(): void {
  search.open = false;
  // Панель закрыли — пометки совпадений уходят с ней. Тот же приём, что
  // при переезде панели в соседнюю область: запрос с пустой строкой.
  // До задачи 100 этого не требовалось: помечать было нечем.
  if (applied) {
    engine.apply(applied, { ...query(), term: '' });
    applied = null;
  }
  editorView()?.focus();
}

export function findNext(): void {
  const view = editorView();
  if (!view || search.term === '') return;
  engine.apply(view, query());
  engine.next(view);
  scheduleRecount();
}

export function findPrevious(): void {
  const view = editorView();
  if (!view || search.term === '') return;
  engine.apply(view, query());
  engine.previous(view);
  scheduleRecount();
}

export function replaceCurrent(): void {
  const view = editorView();
  if (!view || search.term === '') return;
  engine.apply(view, query());
  engine.replaceOne(view);
  scheduleRecount();
}

export function replaceEverything(): void {
  const view = editorView();
  if (!view || search.term === '') return;
  engine.apply(view, query());
  engine.replaceEvery(view);
  scheduleRecount();
}
