import { Compartment, EditorState, type Extension } from '@codemirror/state';
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
import { search, highlightSelectionMatches } from '@codemirror/search';
import { syntaxColors } from '../theme/syntax';
import type { Buffer } from '../ipc/files';

/**
 * Отсек, в который приезжает язык подсветки.
 *
 * Язык грузится асинхронно, а состояние вкладки нужно создать сразу — иначе
 * открытие файла ждало бы скачивания парсера. Отсек позволяет подменить часть
 * настроек уже существующего состояния, не пересобирая его целиком и не теряя
 * историю отмены.
 *
 * Один на всё приложение, а не по одному на вкладку: отсек — это ключ
 * в настройках состояния, и у каждого состояния своё содержимое под этим
 * ключом.
 */
export const languageCompartment = new Compartment();

/**
 * Набор расширений редактора для конкретного буфера.
 *
 * Раскладка Notepad++ живёт в оконном диспетчере (`keymap/`), а не здесь:
 * она общая для всего приложения, а не только для области текста.
 */
export function extensionsFor(
  meta: Buffer,
  onChange: (view: EditorView) => void,
): Extension[] {
  const readOnly = meta.readOnly;

  return [
    // Пусто до тех пор, пока не приедет язык. Большие файлы остаются
    // без подсветки навсегда — это записанная политика больших файлов.
    languageCompartment.of([]),
    syntaxColors,

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

    // Поиск подключается ради состояния запроса и подсветки совпадений.
    // Собственная панель CodeMirror намеренно не открывается: её разметка
    // несёт свои размеры и цвета, то есть прошла бы мимо слоя токенов.
    // Панель у нас своя, в `ui/SearchPanel.svelte`.
    search(),
    highlightSelectionMatches(),

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
