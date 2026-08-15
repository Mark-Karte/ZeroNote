import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
} from '@codemirror/view';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import type { Buffer } from '../ipc/files';

/**
 * Набор расширений редактора для конкретного буфера.
 *
 * Раскладка Notepad++ появится в задаче 7 и ляжет поверх этой; сейчас
 * подключён набор по умолчанию, чтобы редактор был работоспособен.
 * Подсветка синтаксиса — этап 2.
 */
export function extensionsFor(
  meta: Buffer,
  onChange: (view: EditorView) => void,
): Extension[] {
  const readOnly = meta.readOnly;

  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    // Перенос строк выключен: так ведёт себя Notepad++, и для кода это
    // правильное умолчание. Переключатель — задача полировки.
    EditorState.allowMultipleSelections.of(true),
    keymap.of([...defaultKeymap, ...historyKeymap]),

    // Упрощённый режим больших файлов и файлы «только для чтения».
    // `readOnly` запрещает правку, `editable` убирает курсор ввода:
    // без второго пользователь видит мигающую каретку и не понимает,
    // почему ввод не работает.
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),

    EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet) {
        onChange(update.view);
      }
    }),
  ];
}
