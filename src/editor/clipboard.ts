import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';

/**
 * Вырезание, копирование и вставка — со стороны состояния редактора.
 *
 * Здесь только расчёт: что попадёт в буфер обмена и какая правка получится
 * из вставленного. Само обращение к буферу — в `actions/clipboard.ts`.
 *
 * Зачем это вообще написано. Клавиши `Ctrl+X`, `Ctrl+C` и `Ctrl+V` в области
 * текста обслуживает сам вебвью, и обслуживает правильно — их мы не трогаем
 * (Р-108). Но пункт меню нажатием клавиши не является, и заставить браузер
 * скопировать «как будто нажали Ctrl+C» нельзя: `execCommand('copy')`
 * при пустом выделении не делает ничего, а `execCommand('paste')` запрещён
 * в Chromium вовсе.
 *
 * Поэтому поведение повторено по исходникам CodeMirror — до мелочей, включая
 * копирование целых строк при пустом выделении и раздачу строк по курсорам
 * при вставке. Расхождение здесь было бы худшего сорта: пункт меню и клавиша
 * называются одинаково, а делают разное.
 */

export interface Copied {
  /** Что кладётся в буфер обмена. */
  text: string;
  /** Что удаляется, если это было вырезание. */
  cut: TransactionSpec;
  /**
   * Копировались целые строки — выделения не было.
   *
   * Признак нужен вставке: строку, скопированную целиком, вставляют перед
   * текущей строкой, а не в середину слова, на котором стоит курсор.
   */
  linewise: boolean;
}

/**
 * Что копировать и что при вырезании удалять.
 *
 * Пустое выделение означает «вся строка» — так ведёт себя и CodeMirror,
 * и Notepad++, и любой редактор, где `Ctrl+C` без выделения не бесполезен.
 * Курсоры на одной строке дают её один раз, а не по разу на курсор.
 */
export function copiedText(state: EditorState): Copied {
  const parts: string[] = [];
  const ranges: { from: number; to: number }[] = [];

  for (const range of state.selection.ranges) {
    if (range.empty) continue;
    parts.push(state.sliceDoc(range.from, range.to));
    ranges.push({ from: range.from, to: range.to });
  }

  let linewise = false;
  if (parts.length === 0) {
    let seen = -1;
    for (const range of state.selection.ranges) {
      const line = state.doc.lineAt(range.from);
      if (line.number > seen) {
        parts.push(line.text);
        // Вместе с переносом: вырезанная строка не должна оставлять
        // за собой пустую.
        ranges.push({
          from: line.from,
          to: Math.min(state.doc.length, line.to + state.lineBreak.length),
        });
      }
      seen = line.number;
    }
    linewise = true;
  }

  return {
    text: parts.join(state.lineBreak),
    cut: { changes: ranges, scrollIntoView: true, userEvent: 'delete.cut' },
    linewise,
  };
}

/**
 * Правка от вставки.
 *
 * Три случая, и все три взяты у CodeMirror:
 *
 * * **Построчная вставка** — вставляем целыми строками перед текущими,
 *   если этот же текст был скопирован целыми строками.
 * * **Строк столько же, сколько курсоров** — каждому курсору своя строка.
 *   Ради этого мультикурсор и заводят.
 * * **Всё остальное** — обычная замена выделения.
 */
export function pasteSpec(
  state: EditorState,
  input: string,
  fromLinewiseCopy: boolean,
): TransactionSpec {
  const text = state.toText(input);
  const byLine = text.lines === state.selection.ranges.length;
  const linewise =
    fromLinewiseCopy && state.selection.ranges.every((range) => range.empty);

  if (linewise) {
    let lastLine = -1;
    let index = 1;
    return {
      ...state.changeByRange((range) => {
        const line = state.doc.lineAt(range.from);
        // Два курсора на одной строке не должны вставить её содержимое дважды.
        if (line.from === lastLine) return { range };
        lastLine = line.from;
        const insert = (byLine ? text.line(index++)!.text : input) + state.lineBreak;
        return {
          changes: { from: line.from, insert },
          range: EditorSelection.cursor(range.from + insert.length),
        };
      }),
      scrollIntoView: true,
      userEvent: 'input.paste',
    };
  }

  if (byLine) {
    let index = 1;
    return {
      ...state.changeByRange((range) => {
        const line = text.line(index++)!;
        return {
          changes: { from: range.from, to: range.to, insert: line.text },
          range: EditorSelection.cursor(range.from + line.length),
        };
      }),
      scrollIntoView: true,
      userEvent: 'input.paste',
    };
  }

  return {
    ...state.replaceSelection(text),
    scrollIntoView: true,
    userEvent: 'input.paste',
  };
}
