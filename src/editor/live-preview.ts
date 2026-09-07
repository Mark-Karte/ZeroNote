import { syntaxTree } from '@codemirror/language';
import type { EditorState, Line, Range } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';

import { icon } from '../icons/registry';
import { CALLOUT_ICON, parseCallout, type CalloutKind } from './callouts';
import { ImageWidget, localTarget } from './images';
import { wikilinkSpans } from './wikilinks';

/**
 * Живое превью markdown: разметка не показывается, а действует.
 *
 * Задача 57 сделала оформление в исходнике — жирный жирным, но со звёздочками
 * на экране. Живое превью убирает знаки: `**жирный**` показывается как
 * **жирный**, `# Заголовок` — заголовком без решётки, `[текст](url)` — одним
 * текстом, `---` — чертой.
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
 * Задача 64. Блочная разметка — заголовок, цитата, черта — разбирается ниже
 * отдельно: у неё знак не окружает текст, а стоит перед ним.
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

/** Строка `---` рисуется чертой, а не дефисами. */
const ruleLine = Decoration.line({ class: 'zn-hr' });

/** Остаток первой строки callout-а — его заголовок. */
const calloutTitle = Decoration.mark({ class: 'zn-callout-title' });

/**
 * Значок callout-а: рисуется вместо знака `[!tip]`.
 *
 * Виджет, а не украшение текста: на месте знака должен появиться рисунок,
 * которого в документе нет. Документ при этом не меняется ни на знак —
 * `Decoration.replace` подменяет показ (Р-160).
 */
class CalloutIcon extends WidgetType {
  constructor(readonly kind: CalloutKind) {
    super();
  }

  /** Без этого узел пересоздаётся на каждой пересборке украшений. */
  override eq(other: CalloutIcon): boolean {
    return other.kind === this.kind;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'zn-callout-icon';
    // Разметка из собственного реестра значков, а не из файла пользователя.
    span.innerHTML = icon(CALLOUT_ICON[this.kind]);
    return span;
  }
}

/** Задевает ли строку курсор или выделение. */
export function touched(state: EditorState, line: Line): boolean {
  // Перебором по выделениям, а не набором номеров строк: `Ctrl+A` в файле
  // на десять мегабайт дал бы набор в миллион чисел на каждое нажатие.
  // Выделений обычно одно, курсоров — единицы.
  return state.selection.ranges.some((range) => range.from <= line.to && range.to >= line.from);
}

/** Сколько пробелов стоит за знаком: они прячутся вместе с ним. */
function spacesAfter(state: EditorState, at: number, limit: number): number {
  let end = at;
  while (end < limit && state.doc.sliceString(end, end + 1) === ' ') end += 1;
  return end - at;
}

/**
 * Спрятать разметку в заданных отрезках документа.
 *
 * Принимает состояние и отрезки, а не представление, — чтобы проверяться
 * тестом без окна. Отрезки — видимые: заметка бывает длиной в мегабайт,
 * а на экране всегда полсотни строк (инвариант 6).
 */
export function decorateLivePreview(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  /**
   * Путь к самой заметке: от её папки считается относительный путь картинки.
   * `null` — заметку ещё не сохранили, и считать не от чего.
   */
  sourcePath: () => string | null = () => null,
): DecorationSet {
  const found: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  const { doc } = state;

  /** Спрятать кусок, если его строку не задевает курсор (Р-158). */
  const hide = (from: number, to: number): void => {
    if (from >= to) return;
    if (touched(state, doc.lineAt(from))) return;
    found.push(hidden.range(from, to));
  };

  // Вики-ссылки разбираются первыми: их знаки не в дереве, а внутри `[[…]]`
  // лежит чужой узел `Link`, который иначе спрятался бы наполовину.
  const wiki: { from: number; to: number }[] = [];

  for (const range of ranges) {
    const text = doc.sliceString(range.from, range.to);

    for (const span of wikilinkSpans(text)) {
      const from = range.from + span.from;
      const to = range.from + span.to;
      wiki.push({ from, to });

      // `[[цель|подпись]]` показывается подписью: цель уезжает вместе
      // со скобками. `[[имя]]` — просто именем.
      const alias = span.inner.indexOf('|');
      const head = alias >= 0 ? from + 2 + alias + 1 : from + 2;
      hide(from, head);
      hide(to - 2, to);
    }
  }

  const insideWiki = (from: number): boolean =>
    wiki.some((span) => from >= span.from && from < span.to);

  // Строки, уже получившие карточку: у вложенного callout-а внутри callout-а
  // строка иначе получила бы два фона. Первый — внешний — выигрывает.
  const carded = new Set<number>();

  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        const parent = node.node.parent;

        // Таблицу этот плагин не трогает: она заменяется целиком, а замена
        // через границу строк меняет высоту документа, и такие украшения
        // CodeMirror от плагина не принимает вовсе — только от поля состояния.
        // Её показ живёт в `tables.ts` (задача 73). Внутрь не спускаемся:
        // украшать то, что закрыто сеткой, незачем.
        if (node.name === 'Table') return false;

        // Знаки вокруг куска текста: `**`, `*`, `~~`, `==`, обратная кавычка.
        if (MARKS.has(node.name)) {
          if (parent && INLINE.has(parent.name)) hide(node.from, node.to);
          return;
        }

        // Решётка заголовка — вместе с пробелом за ней: иначе текст
        // заголовка съезжал бы вправо на один знак.
        if (node.name === 'HeaderMark' && parent?.name.startsWith('ATXHeading')) {
          const line = doc.lineAt(node.from);
          hide(node.from, node.to + spacesAfter(state, node.to, line.to));
          return;
        }

        // Угловая скобка цитаты — тоже с пробелом. Черта слева остаётся:
        // её рисует украшение строки (задача 57, Р-153).
        //
        // Родитель здесь не проверяется, в отличие от прочих знаков, и это
        // не небрежность: у второй строки цитаты `QuoteMark` лежит внутри
        // `Paragraph`, а не `Blockquote` — абзац тянется через строки
        // (ленивое продолжение CommonMark, то же, что поправило ожидание
        // в задаче 57). При этом `QuoteMark` рождает только разбор цитаты,
        // так что имени узла достаточно.
        if (node.name === 'QuoteMark') {
          const line = doc.lineAt(node.from);
          hide(node.from, node.to + spacesAfter(state, node.to, line.to));
          return;
        }

        // Картинка показывается картинкой: вся запись `![подпись](файл.png)`
        // заменяется рисунком (задача 72).
        //
        // Единица раскрытия здесь — вся запись, а не знак (Р-184): курсор
        // на строке возвращает исходник целиком, и этим же ответом закрыт
        // вопрос «как удалить картинку» — стереть строку.
        if (node.name === 'Image') {
          const line = doc.lineAt(node.from);
          if (touched(state, line)) return false;

          const url = node.node.getChild('URL');
          if (!url) return false;

          // Сетевой адрес не загружается никогда (Р-202): открыв чужую
          // заметку, человек не просил ходить в сеть. Такая запись остаётся
          // исходником — по нему сразу видно, почему картинки нет.
          const link = localTarget(doc.sliceString(url.from, url.to));
          if (link === null) return false;

          // Подпись — то, что между `![` и `]`. Границы берутся у знаков,
          // а не отсчитываются от края: `![` это два знака, а `]` может быть
          // где угодно.
          const marks = node.node.getChildren('LinkMark');
          const alt =
            marks.length >= 2 ? doc.sliceString(marks[0]!.to, marks[1]!.from) : '';

          found.push(
            Decoration.replace({
              widget: new ImageWidget(link, sourcePath(), alt),
            }).range(node.from, node.to),
          );
          // Внутрь не спускаемся: знаки и адрес уже заменены целиком.
          return false;
        }

        // Ссылка показывается своим текстом: скобки и адрес прячутся.
        //
        // Только `Link`. У картинки узлы те же, и разбирается она выше —
        // целиком, а не по знакам.
        if ((node.name === 'LinkMark' || node.name === 'URL') && parent?.name === 'Link') {
          if (!insideWiki(node.from)) hide(node.from, node.to);
          return;
        }

        // Callout: цитата, первая строка которой написана `[!тип] Заголовок`.
        //
        // Карточка остаётся и под курсором, в отличие от спрятанных знаков:
        // она оформление строки, как черта у цитаты (Р-153). По правилу Р-158
        // возвращается только сам знак `[!тип]` — вместо значка.
        if (node.name === 'Blockquote') {
          const first = doc.lineAt(node.from);
          const marker = parseCallout(first.text);
          if (!marker) return;

          // Шаг назад: у цитаты, дописанной до конца документа, `node.to`
          // указывает уже на начало следующей строки. Та же поправка,
          // что у блоков кода и у цитат.
          const last = doc.lineAt(Math.min(Math.max(node.from, node.to - 1), range.to));

          for (let number = first.number; number <= last.number; number += 1) {
            if (carded.has(number)) continue;
            carded.add(number);

            const parts = ['zn-callout', `zn-callout-${marker.kind}`];
            if (number === first.number) parts.push('zn-callout-first');
            if (number === last.number) parts.push('zn-callout-last');

            found.push(Decoration.line({ class: parts.join(' ') }).range(doc.line(number).from));
          }

          const markFrom = first.from + marker.from;
          const markTo = first.from + marker.to;

          if (!touched(state, first)) {
            found.push(
              Decoration.replace({ widget: new CalloutIcon(marker.kind) }).range(markFrom, markTo),
            );
          }
          if (markTo < first.to) {
            found.push(calloutTitle.range(markTo, first.to));
          }
          return;
        }

        // Горизонтальная черта рисуется чертой, а не дефисами. Это отменяет
        // правило задачи 57 для превью — ровно то, о чём предупреждает Р-160.
        if (node.name === 'HorizontalRule') {
          const line = doc.lineAt(node.from);
          if (touched(state, line)) return;
          found.push(ruleLine.range(line.from));
          hide(node.from, node.to);
        }
      },
    });
  }

  // Сортировка вместо `RangeSetBuilder`: источников два — дерево разбора
  // и свой разбор вики-ссылок, — и в порядке возрастания они приходят
  // только вперемешку.
  return Decoration.set(found, true);
}

/**
 * Живое превью. Ставится отсеком: настройка переключается на лету.
 *
 * Пересборка идёт и на смену выделения — без этого правило строки под
 * курсором не работает вовсе.
 */
export function livePreview(sourcePath: () => string | null = () => null) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = decorateLivePreview(view.state, view.visibleRanges, sourcePath);
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
          this.decorations = decorateLivePreview(
            update.view.state,
            update.view.visibleRanges,
            sourcePath,
          );
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
