import type { EditorView } from '@codemirror/view';
import { EditorSelection, type ChangeSpec } from '@codemirror/state';
import {
  undo,
  redo,
  selectAll,
  selectLine,
  undoSelection,
  redoSelection,
  toggleComment,
  moveLineUp,
  moveLineDown,
} from '@codemirror/commands';
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

/**
 * Взято у CodeMirror целиком и не переписано.
 *
 * Четыре из них до задачи 41 уже работали — их приносил набор
 * `defaultKeymap`, — но были не видны: ни в палитре, ни в меню, ни в
 * `keymap.toml`. Переназначить их было нельзя, а найти можно было только
 * в чужой документации. Теперь у них есть имена в реестре, и сочетание
 * над ними наше (Р-122).
 *
 * Своих реализаций им не написано намеренно: `selectLine` знает про
 * множественные курсоры и про уже выделенные строки, `toggleComment` берёт
 * знак комментария из разбора языка, а отмена курсора живёт в той же истории,
 * что и отмена правки. Всё это мы бы повторяли, а не улучшали.
 *
 * Перемещение строк пришло сюда позже остальных, задачей 52, и не потому,
 * что не было написано, а потому, что было написано хуже (Р-142). Своя
 * реализация двигала строку главного курсора и молча не замечала остальные,
 * хотя тем же самым `Alt+↑` из `defaultKeymap` двигались все выделенные:
 * два сочетания «одного и того же» вели себя по-разному.
 */
export {
  undo,
  redo,
  selectAll,
  selectLine,
  undoSelection,
  redoSelection,
  toggleComment,
  moveLineUp,
  moveLineDown,
};
