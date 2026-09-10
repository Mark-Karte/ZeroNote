import type { EditorState, Extension, Range } from '@codemirror/state';
import { getSearchQuery, setSearchQuery } from '@codemirror/search';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

/**
 * Подсветка совпадений поиска по файлу (задача 100).
 *
 * Своя, хотя подсветка есть и в `@codemirror/search`. Причина простая
 * и найдена разбором: их подсветка включается только **при открытой их же
 * панели** (`if (!panel || !query.spec.valid) return Decoration.none`),
 * а панель у нас своя — CodeMirror свою не открывает никогда. Значит,
 * с этапа 1 поиск по файлу считал совпадения («2 из 17») и прыгал по ним,
 * но на экране не помечал ни одного: видно было только то, на котором
 * стоит курсор, — и то потому, что переход делает его выделением.
 *
 * Обходятся **только видимые отрезки** (инвариант 6): совпадений в файле
 * на десять мегабайт могут быть тысячи, а нарисовать можно лишь то, что
 * на экране.
 *
 * Текущее совпадение своей пометки не имеет: переход выделяет его,
 * а выделение и есть самая заметная пометка в редакторе.
 */

const matchDeco = Decoration.mark({ class: 'zn-search-match' });

/**
 * Совпадения запроса внутри заданных отрезков.
 *
 * Вынесено из плагина отдельной функцией, чтобы проверяться без окна:
 * представление здесь нужно ровно за одним — списком видимых отрезков.
 */
export function searchMatchRanges(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): { from: number; to: number }[] {
  const query = getSearchQuery(state);
  // Пустая строка и незакрытая скобка в выражении — оба случая здесь.
  if (!query.valid) return [];

  const found: { from: number; to: number }[] = [];

  for (const range of ranges) {
    const cursor = query.getCursor(state, range.from, range.to);
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      // Совпадение нулевой длины даёт выражение вроде `\b`: рисовать нечего,
      // а набор украшений от пустого диапазона не откажется молча.
      if (step.value.to > step.value.from) found.push(step.value);
    }
  }

  return found;
}

function decorations(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = searchMatchRanges(view.state, view.visibleRanges).map(
    (match) => matchDeco.range(match.from, match.to),
  );
  return Decoration.set(marks);
}

export const searchMatches: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = decorations(view);
    }

    update(update: ViewUpdate): void {
      const queryChanged = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(setSearchQuery)),
      );
      // Прокрутка меняет видимые отрезки, а значит и то, что надо пометить.
      if (update.docChanged || update.viewportChanged || queryChanged) {
        this.decorations = decorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
