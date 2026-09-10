import type { EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/**
 * Подсветка строки курсора — своя, а не `highlightActiveLine()` (задача 100).
 *
 * Причина одна и она про выделение. Слой выделения CodeMirror лежит **под**
 * содержимым (`z-index: -1`), а подсветка строки красит саму строку —
 * то есть кроет выделение сверху. У CodeMirror цвет строки полупрозрачный
 * (`#cceeff44`), и выделение сквозь него видно; у нас это роль «наведение»,
 * сплошная, и выделение под ней исчезало целиком. А выделяют чаще всего
 * слово в той самой строке, где стоит курсор.
 *
 * Ответ тот же, что в VS Code: **пока выделение не пусто, подсветки строки
 * нет.** Строку показывает само выделение, и второй пометки не нужно.
 *
 * В поле номеров всё остаётся как было (`highlightActiveLineGutter`):
 * там перекрывать нечего, а метка «вот где курсор» при длинном выделении
 * как раз полезна.
 *
 * Считается фасетом от состояния, а не плагином представления: геометрия
 * здесь не нужна — начало строки знает документ, — зато такое расширение
 * проверяется тестом без окна.
 */

const lineDeco = Decoration.line({ class: 'cm-activeLine' });

/**
 * Строки, которые надо подсветить: по одной на каждый **пустой** курсор.
 *
 * Непустые диапазоны пропускаются поштучно, а не «есть выделение — нет
 * подсветки вовсе»: при нескольких курсорах часть из них может стоять
 * пустой, и их строки подсветить по-прежнему верно.
 */
export function activeLineDecorations(state: EditorState): DecorationSet {
  const deco = [];
  let last = -1;

  for (const range of state.selection.ranges) {
    if (!range.empty) continue;

    const line = state.doc.lineAt(range.head);
    // Два курсора на одной строке дали бы два одинаковых украшения, а набор
    // украшений не терпит повторов на одной позиции.
    if (line.from > last) {
      deco.push(lineDeco.range(line.from));
      last = line.from;
    }
  }

  return Decoration.set(deco);
}

export const activeLine: Extension = EditorView.decorations.compute(
  ['selection'],
  activeLineDecorations,
);
