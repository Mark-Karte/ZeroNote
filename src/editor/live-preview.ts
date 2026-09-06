import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorState, type Line } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';

/**
 * Живое превью markdown: знаки вокруг текста прячутся.
 *
 * Задача 57 сделала оформление в исходнике — жирный жирным, но со звёздочками
 * на экране. Живое превью убирает знаки: `**жирный**` показывается как
 * **жирный**, `==выделение==` — цветом, `` `код` `` — подложкой без обратных
 * кавычек.
 *
 * Три правила, на которых всё держится, записаны до кода:
 *
 * * **строка под курсором показывается исходником** (Р-158). Любая строка,
 *   которую задевает курсор или выделение, рисуется со знаками. Отсюда
 *   следует, что править разметку можно всегда — достаточно поставить курсор
 *   на строку, — и что вопрос «как курсор ходит сквозь спрятанное» почти
 *   исчезает: спрятанного на строке курсора не бывает;
 * * **прячется показ, а не текст** (Р-160). `Decoration.replace` меняет то,
 *   что рисуется, а не то, что лежит в состоянии, поэтому копирование отдаёт
 *   исходник со знаками, то есть файл. Инвариант 1 не задет ни на байт;
 * * **украшения пересобираются на смену выделения**, а не только на правку
 *   и прокрутку. Это новая работа на пути ввода, и приёмка этапа меряет её
 *   отдельно.
 */

/**
 * Узлы, чьи знаки прячутся: пара ограничителей вокруг куска текста.
 *
 * Заголовки, цитаты и ссылки сюда не входят — у них знак не окружает текст,
 * а стоит перед ним и меняет строку целиком; это задача 65.
 */
const INLINE = new Set(['Emphasis', 'StrongEmphasis', 'Strikethrough', 'Highlight', 'InlineCode']);

/**
 * Сами знаки.
 *
 * Проверяется и знак, и его родитель. Одного имени знака мало: `CodeMark` —
 * это и обратная кавычка внутри строки, и ограждение блока кода из трёх
 * кавычек. Блок кода мы не трогаем: там разметка и есть содержимое.
 */
const MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'HighlightMark', 'CodeMark']);

/** Пустая замена: место знака не занимает ничего. */
const hidden = Decoration.replace({});

/** Задевает ли строку курсор или выделение. */
function touched(state: EditorState, line: Line): boolean {
  // Перебором по выделениям, а не набором номеров строк: `Ctrl+A` в файле
  // на десять мегабайт дал бы набор в миллион чисел на каждое нажатие.
  // Выделений обычно одно, курсоров — единицы.
  return state.selection.ranges.some(
    (range) => range.from <= line.to && range.to >= line.from,
  );
}

/**
 * Спрятать знаки разметки в заданных отрезках документа.
 *
 * Принимает состояние и отрезки, а не представление, — чтобы проверяться
 * тестом без окна. Отрезки — видимые: заметка бывает длиной в мегабайт,
 * а на экране всегда полсотни строк (инвариант 6).
 */
export function decorateLivePreview(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(state);

  // `RangeSetBuilder` требует строго возрастающих позиций и падает на повторе.
  // Знак, попавший на границу двух видимых отрезков, обошёлся бы дважды.
  let lastTo = -1;

  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (!MARKS.has(node.name)) return;

        const parent = node.node.parent;
        if (!parent || !INLINE.has(parent.name)) return;

        if (node.from < lastTo) return;

        // Строка курсора показывается исходником целиком (Р-158).
        if (touched(state, state.doc.lineAt(node.from))) return;

        lastTo = node.to;
        builder.add(node.from, node.to, hidden);
      },
    });
  }

  return builder.finish();
}

/**
 * Живое превью. Ставится отсеком: настройка переключается на лету.
 *
 * Пересборка идёт и на смену выделения — без этого правило строки под
 * курсором не работает вовсе.
 */
export function livePreview() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = decorateLivePreview(view.state, view.visibleRanges);
      }

      update(update: ViewUpdate) {
        // Сравнение деревьев обязательно, и это найдено на живом окне.
        // Отсек с превью собирается при создании состояния, а разбор markdown
        // приезжает позже и отдельно (`languageCompartment`): в тот момент
        // дерева ещё нет, украшения выходят пустыми, а пересборки по правке,
        // прокрутке и выделению не случается. Файл открывался со знаками
        // разметки и раскрывался только от первого щелчка в текст.
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = decorateLivePreview(update.view.state, update.view.visibleRanges);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/** Что нужно знать, чтобы решить, включено ли превью в этой вкладке. */
export interface LivePreviewContext {
  /** Общая настройка `[editor] live_preview`. */
  livePreview: boolean;
  /** Markdown ли в этой вкладке. */
  markdown: boolean;
}

/**
 * Включено ли живое превью в этой вкладке.
 *
 * Только markdown (Р-159): ни в коде, ни в обычном тексте разметки нет,
 * и прятать там нечего. Настройка при этом общая, как перенос строк, —
 * это способ смотреть на текст, а не свойство файла.
 */
export function livePreviewOn(ctx: LivePreviewContext): boolean {
  return ctx.livePreview && ctx.markdown;
}
