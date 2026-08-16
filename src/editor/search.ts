import type { EditorView } from '@codemirror/view';
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from '@codemirror/search';

/**
 * Обёртка над поиском CodeMirror.
 *
 * Сам поиск, включая регулярные выражения, делает `@codemirror/search`:
 * писать своё было бы переписыванием курсора по документу с учётом переносов
 * и границ слов — работа на неделю ради того, что уже есть в подключённой
 * библиотеке.
 *
 * Панель при этом наша: разметка CodeMirror несёт собственные размеры
 * и цвета, то есть прошла бы мимо слоя токенов.
 */

export interface Query {
  term: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

/** Сколько совпадений и на котором из них курсор. */
export interface Matches {
  total: number;
  /** Номер текущего совпадения, начиная с единицы. Ноль — курсор не на нём. */
  current: number;
  /** Выражение не разбирается: незакрытая скобка в регулярном выражении. */
  invalid: boolean;
}

function build(query: Query): SearchQuery {
  return new SearchQuery({
    search: query.term,
    replace: query.replacement,
    caseSensitive: query.caseSensitive,
    wholeWord: query.wholeWord,
    regexp: query.regexp,
  });
}

/** Сообщить редактору текущий запрос: от него зависят подсветка и переходы. */
export function apply(view: EditorView, query: Query): void {
  view.dispatch({ effects: setSearchQuery.of(build(query)) });
}

export function next(view: EditorView): void {
  findNext(view);
  view.focus();
}

export function previous(view: EditorView): void {
  findPrevious(view);
  view.focus();
}

export function replaceOne(view: EditorView): void {
  replaceNext(view);
}

export function replaceEvery(view: EditorView): void {
  replaceAll(view);
}

/**
 * Пересчёт совпадений для счётчика «3 из 17».
 *
 * Считается по всему документу. На файле в десять мегабайт это заметная
 * работа, поэтому вызывается не на каждое нажатие клавиши, а с задержкой —
 * см. `state/search.svelte.ts`.
 */
export function count(view: EditorView, query: Query): Matches {
  if (query.term === '') {
    return { total: 0, current: 0, invalid: false };
  }

  const built = build(query);
  // Незакрытая скобка в регулярном выражении — обычное состояние текста,
  // который пользователь ещё дописывает. Это не ошибка, а «пока нечего искать».
  if (!built.valid) {
    return { total: 0, current: 0, invalid: true };
  }

  const head = view.state.selection.main.from;
  let total = 0;
  let current = 0;

  try {
    const cursor = built.getCursor(view.state);
    for (let value = cursor.next(); !value.done; value = cursor.next()) {
      total += 1;
      if (current === 0 && value.value.from >= head) {
        current = total;
      }
    }
  } catch {
    // getCursor бросает на выражениях, которые прошли проверку valid,
    // но не принимаются движком регулярных выражений браузера.
    return { total: 0, current: 0, invalid: true };
  }

  return { total, current, invalid: false };
}
