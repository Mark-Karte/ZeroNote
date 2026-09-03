import type { EditorView } from '@codemirror/view';
import { EditorSelection, type ChangeSpec } from '@codemirror/state';
import { undo, redo, selectAll } from '@codemirror/commands';
import { selectNextOccurrence } from '@codemirror/search';

/**
 * Операции с текстом.
 *
 * Написаны своими руками, а не взяты из `@codemirror/commands`, там, где
 * поведение Notepad++ отличается от принятого в CodeMirror. Это требование
 * совместимости: человек приходит с мышечной памятью, и «почти так же»
 * раздражает сильнее, чем «совсем иначе».
 *
 * Все они работают со **всеми** выделениями сразу — множественные курсоры
 * включены, и операция, применяющаяся только к первому, выглядела бы поломкой.
 */

/**
 * Ctrl+D — добавить курсор на следующее такое же слово.
 *
 * Взято у CodeMirror целиком: поведение здесь тонкое — первое нажатие выделяет
 * слово под курсором, следующие добавляют вхождения, поиск идёт по кругу
 * и учитывает границы слова. Своя реализация была бы «почти такой же»,
 * а это раздражает сильнее, чем «совсем иначе».
 */
export function addCursorNext(view: EditorView): boolean {
  return selectNextOccurrence(view);
}

/** Строки, затронутые выделениями, без повторов и по порядку. */
function touchedLines(view: EditorView): { from: number; to: number }[] {
  const doc = view.state.doc;
  const ranges: { from: number; to: number }[] = [];

  for (const range of view.state.selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;

    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      // Одну строку могли задеть два курсора — второй раз обрабатывать нельзя.
      if (ranges.length > 0 && ranges[ranges.length - 1]!.from === line.from) continue;
      ranges.push({ from: line.from, to: line.to });
    }
  }

  return ranges;
}

/** Ctrl+Shift+D — продублировать строку под текущей. */
export function duplicateLine(view: EditorView): boolean {
  const doc = view.state.doc;
  const changes: ChangeSpec[] = touchedLines(view).map(({ from, to }) => ({
    from: to,
    insert: '\n' + doc.sliceString(from, to),
  }));

  if (changes.length === 0) return false;
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.duplicate' });
  return true;
}

/** Ctrl+L — удалить строку целиком, вместе с переводом. */
export function deleteLine(view: EditorView): boolean {
  const doc = view.state.doc;
  const changes: ChangeSpec[] = touchedLines(view).map(({ from, to }) => ({
    // Забираем и перевод строки: иначе на месте удалённой останется пустая.
    // На последней строке файла перевода нет — забираем предыдущий.
    from: to < doc.length ? from : Math.max(0, from - 1),
    to: to < doc.length ? to + 1 : to,
  }));

  if (changes.length === 0) return false;
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'delete.line' });
  return true;
}

/** Перенос строки на одну позицию вверх или вниз. */
function moveLine(view: EditorView, delta: -1 | 1): boolean {
  const doc = view.state.doc;
  const line = doc.lineAt(view.state.selection.main.head);
  const target = line.number + delta;

  // За края документа двигать некуда.
  if (target < 1 || target > doc.lines) return false;

  const other = doc.line(target);
  const cursorOffset = view.state.selection.main.head - line.from;

  // Меняем строки местами, переписывая обе разом: так операция остаётся
  // одним шагом отмены, а не двумя.
  const [first, second] = delta === -1 ? [other, line] : [line, other];
  const swapped = `${second.text}\n${first.text}`;

  view.dispatch({
    changes: { from: first.from, to: second.to, insert: swapped },
    selection: EditorSelection.cursor(
      (delta === -1 ? other.from : other.from + line.text.length - other.text.length) +
        cursorOffset,
    ),
    scrollIntoView: true,
    userEvent: 'move.line',
  });
  return true;
}

export const moveLineUp = (view: EditorView): boolean => moveLine(view, -1);
export const moveLineDown = (view: EditorView): boolean => moveLine(view, 1);

/** Смена регистра выделения. Без выделения делать нечего. */
function changeCase(view: EditorView, to: 'upper' | 'lower'): boolean {
  const changes: ChangeSpec[] = [];

  for (const range of view.state.selection.ranges) {
    if (range.empty) continue;
    const text = view.state.doc.sliceString(range.from, range.to);
    changes.push({
      from: range.from,
      to: range.to,
      insert: to === 'upper' ? text.toUpperCase() : text.toLowerCase(),
    });
  }

  if (changes.length === 0) return false;
  // Выделение сохраняется: длина текста при смене регистра не меняется.
  view.dispatch({ changes, userEvent: 'input.case' });
  return true;
}

export const upperCase = (view: EditorView): boolean => changeCase(view, 'upper');
export const lowerCase = (view: EditorView): boolean => changeCase(view, 'lower');

/** Поставить курсор на строку с указанным номером. */
export function goToLine(view: EditorView, line: number): boolean {
  const doc = view.state.doc;
  // Номер за пределами документа прижимаем к краю, а не отказываемся:
  // «перейти к строке 9999» в файле из ста строк — это «в конец».
  const target = doc.line(Math.max(1, Math.min(line, doc.lines)));

  view.dispatch({
    selection: EditorSelection.cursor(target.from),
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export { undo, redo, selectAll };
