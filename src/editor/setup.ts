import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
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
import { bracketMatching } from '@codemirror/language';
import { search, highlightSelectionMatches } from '@codemirror/search';
// Пакет называется `autocomplete`, но берём из него ровно одно — закрытие
// скобок. Автодополнение остаётся вне области первого круга: включается оно
// отдельным вызовом, которого в проекте нет, и это стережёт тест
// `tests/brackets.test.ts` (решение Р-112).
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { syntaxColors } from '../theme/syntax';
import { brackets } from './brackets';
import { folding } from './folding';
import { wikilinks, type Target } from './wikilinks';
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
 * Отсек переноса длинных строк.
 *
 * Тоже отсек, а не значение в наборе расширений: перенос переключается на лету,
 * а пересоздавать состояние ради этого значило бы терять историю отмены.
 * Отсек один на приложение — перенос общий, а не свойство вкладки.
 */
export const wrapCompartment = new Compartment();

/**
 * Отсек автозакрытия скобок.
 *
 * По той же причине, что и перенос: настройка общая, переключается на лету,
 * а пересоздание состояний стёрло бы историю отмены во всех файлах разом.
 */
export const autoCloseCompartment = new Compartment();

/**
 * Что кладётся в отсек автозакрытия.
 *
 * `Prec.high` не украшение: `closeBracketsKeymap` перехватывает `Backspace`,
 * чтобы удалять пустую пару целиком, а `Backspace` занят и в основной
 * раскладке CodeMirror. Без явного старшинства порядок зависел бы от того,
 * в каком месте набора стоит отсек, — то есть от случайности.
 */
export function autoCloseExtension(enabled: boolean): Extension {
  return enabled ? [closeBrackets(), Prec.high(keymap.of(closeBracketsKeymap))] : [];
}

/**
 * Набор расширений редактора для конкретного буфера.
 *
 * Раскладка Notepad++ живёт в оконном диспетчере (`keymap/`), а не здесь:
 * она общая для всего приложения, а не только для области текста.
 */
export function extensionsFor(
  meta: Buffer,
  onChange: (view: EditorView) => void,
  onFollow: (target: Target) => void,
  sourcePath: () => string | null,
  wrap: boolean,
  autoClose: boolean,
): Extension[] {
  const readOnly = meta.readOnly;

  return [
    // Ссылки и теги: подсветка, пометка висячих и переход по Ctrl+щелчку.
    wikilinks(onFollow, sourcePath),

    // Пусто до тех пор, пока не приедет язык. Большие файлы остаются
    // без подсветки навсегда — это записанная политика больших файлов.
    languageCompartment.of([]),
    syntaxColors,

    lineNumbers(),
    // Поле свёртки — справа от номеров строк, как в Notepad++ и VS Code.
    // Порядок здесь и есть порядок полей на экране.
    folding(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),

    // Перенос по умолчанию выключен — так ведёт себя Notepad++, и для кода это
    // верное умолчание. Значение приходит из настроек, переключается на лету.
    wrapCompartment.of(wrap ? EditorView.lineWrapping : []),

    // Подсветка парной скобки. Пару ищет разбор языка: скобка внутри строки
    // или комментария парой не считается. Где дерева нет — простым просмотром
    // текста, хуже, но не бесполезно.
    bracketMatching(),
    brackets(),
    autoCloseCompartment.of(autoCloseExtension(autoClose)),

    // Мультикурсор. Разрешения мало: без него `selectNextOccurrence` молча
    // схлопывал бы выделения в одно.
    EditorState.allowMultipleSelections.of(true),
    // Alt+щелчок добавляет курсор. У CodeMirror это и есть умолчание, но
    // записано явно: рядом стоит `rectangularSelection`, который тоже слушает
    // Alt, и молчаливое совпадение здесь читается как случайность.
    EditorView.clickAddsSelectionRange.of((event) => event.altKey),

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
