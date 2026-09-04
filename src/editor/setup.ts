import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  type Extension,
} from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  lineNumberMarkers,
  rectangularSelection,
} from '@codemirror/view';
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentLess,
  indentMore,
} from '@codemirror/commands';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { search, highlightSelectionMatches } from '@codemirror/search';
// Пакет называется `autocomplete`, но берём из него ровно одно — закрытие
// скобок. Автодополнение остаётся вне области первого круга: включается оно
// отдельным вызовом, которого в проекте нет, и это стережёт тест
// `tests/brackets.test.ts` (решение Р-112).
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { syntaxColors } from '../theme/syntax';
import { bookmarkField, bookmarkMarkers, bookmarks } from './bookmarks';
import { brackets } from './brackets';
import { columnAt, indentUnitOf, type Indent } from './indent';
import { folding } from './folding';
import { invisibles } from './invisibles';
import { wikilinks, type Target } from './wikilinks';
import { linkSuggestions, type LinkContext } from './suggest';
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
 * Отсек отступа.
 *
 * Здесь отсек нужен не ради настройки, а ради самой модели: отступ — свойство
 * **вкладки**, а не приложения (Р-106). У каждого состояния под этим ключом
 * лежит своё, и в файле с табами `Tab` даёт таб, даже когда в настройках
 * пробелы.
 */
export const indentCompartment = new Compartment();

/** Что кладётся в отсек отступа. */
export function indentExtension(indent: Indent): Extension {
  return [EditorState.tabSize.of(Math.max(1, indent.width)), indentUnit.of(indentUnitOf(indent))];
}

/**
 * `Tab` — отступ, `Shift+Tab` — снять отступ.
 *
 * Сочетание живёт здесь, а не в реестре команд, и это единственное исключение
 * из Р-107. Причина в том, что `Tab` вне текста означает совсем другое —
 * переход по элементам интерфейса. Отняв его глобально, мы отняли бы
 * клавиатурную навигацию у окна параметров и у диалогов.
 *
 * Без выделения вставляется отступ **до ближайшей позиции табуляции**, а не
 * всегда одинаковое число пробелов: так ведут себя и VS Code, и Notepad++,
 * и иначе набор в середине строки уводил бы текст в случайные столбцы.
 */
function indentOrInsert(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.some((range) => !range.empty)) {
    return indentMore(view);
  }

  // Значение отсека — сама строка отступа:  вернул бы число
  // столбцов, а нам нужно то, что вставляется.
  const unit = state.facet(indentUnit);
  const tabSize = state.tabSize;

  view.dispatch(
    state.changeByRange((range) => {
      const line = state.doc.lineAt(range.head);
      const column = columnAt(state.sliceDoc(line.from, range.head), tabSize);
      const insert = unit === '\t' ? '\t' : ' '.repeat(unit.length - (column % unit.length));

      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + insert.length),
      };
    }),
    { scrollIntoView: true, userEvent: 'input.indent' },
  );
  return true;
}

export const indentKeymap = Prec.high(
  keymap.of([{ key: 'Tab', run: indentOrInsert, shift: indentLess }]),
);

/**
 * Отсек невидимых символов.
 *
 * Настройка общая, как перенос строк: показывать пробелы «в этом файле,
 * но не в том» незачем — это способ смотреть на текст, а не свойство файла.
 */
export const invisiblesCompartment = new Compartment();

/** Что кладётся в отсек невидимых символов. */
export function invisiblesExtension(enabled: boolean): Extension {
  return enabled ? invisibles() : [];
}

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
 * Что нужно знать набору расширений про эту вкладку.
 *
 * Объектом, а не вереницей аргументов: их стало восемь, и половина — `boolean`.
 * Перепутать местами два флага в таком вызове можно молча, а найти потом —
 * только по странному поведению редактора.
 */
export interface EditorOptions {
  onChange: (view: EditorView) => void;
  /**
   * Закладки изменились.
   *
   * Отдельно от `onChange`, потому что переключение закладки не меняет
   * ни текст, ни выделение: обычный обработчик его просто не увидит,
   * состояние вкладки останется прежним, и в сессию уедут вчерашние
   * закладки. Дважды проверено — первая версия так и работала.
   */
  onBookmarks: (view: EditorView) => void;
  onFollow: (target: Target) => void;
  /**
   * Вокруг курсора набирается `[[ссылка]]` — или больше не набирается.
   *
   * Расширение только сообщает; показывать ли список и что в нём, решается
   * выше (Р-132). Редактор не знает ни про индекс, ни про всплывающие окна.
   */
  onLinkContext: (context: LinkContext | null, view: EditorView) => void;
  /** Путь берётся каждый раз заново: «сохранить как» его меняет. */
  sourcePath: () => string | null;
  wrap: boolean;
  autoClose: boolean;
  indent: Indent;
  invisibles: boolean;
  /** Номера строк с закладками — из сессии. Для нового буфера пусто. */
  bookmarks: number[];
}

/**
 * Набор расширений редактора для конкретного буфера.
 *
 * Раскладка живёт в оконном диспетчере (`keymap/`), а не здесь: она общая
 * для всего приложения, а не только для области текста.
 */
export function extensionsFor(meta: Buffer, options: EditorOptions): Extension[] {
  const readOnly = meta.readOnly;

  return [
    // Ссылки и теги: подсветка, пометка висячих и переход по Ctrl+щелчку.
    wikilinks(options.onFollow, options.sourcePath),
    // Подсказка имён при `[[`: расширение сообщает контекст, список живёт выше.
    linkSuggestions(options.onLinkContext),

    // Пусто до тех пор, пока не приедет язык. Большие файлы остаются
    // без подсветки навсегда — это записанная политика больших файлов.
    languageCompartment.of([]),
    syntaxColors,

    lineNumbers(),
    // Закладки помечают ячейку с номером строки — своего поля им не надо.
    bookmarks(options.bookmarks),
    lineNumberMarkers.compute([bookmarkField], (state) => bookmarkMarkers(state)),
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
    wrapCompartment.of(options.wrap ? EditorView.lineWrapping : []),
    invisiblesCompartment.of(invisiblesExtension(options.invisibles)),

    // Подсветка парной скобки. Пару ищет разбор языка: скобка внутри строки
    // или комментария парой не считается. Где дерева нет — простым просмотром
    // текста, хуже, но не бесполезно.
    bracketMatching(),
    brackets(),

    // Отступ — свойство вкладки: он определяется по содержимому файла.
    indentCompartment.of(indentExtension(options.indent)),
    indentKeymap,
    autoCloseCompartment.of(autoCloseExtension(options.autoClose)),

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
        options.onChange(update.view);
      } else if (update.startState.field(bookmarkField) !== update.state.field(bookmarkField)) {
        options.onBookmarks(update.view);
      }
    }),
  ];
}
