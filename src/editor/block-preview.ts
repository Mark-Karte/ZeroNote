import { syntaxTree } from '@codemirror/language';
import {
  RangeSet,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Transaction,
} from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  gutterLineClass,
  type DecorationSet,
} from '@codemirror/view';

import { lookupFor, parseCallout, type CalloutLookup, type CalloutStyle } from './callouts';
import { diagramBlock } from './diagram';
import { touched } from './live-preview';
import { MathWidget, drawsAsBlock, mathSource } from './math';
import { propertiesBlock } from './properties';
import { tableBlock } from './tables';

/**
 * Блочное превью: всё, что заменяется целыми строками, — таблицы
 * (задача 73), блочные формулы (задача 115), схемы mermaid (задача 117)
 * и свойства из frontmatter (задача 127), —
 * и строки, у которых меняются высота и поля, — заголовки (задача 122)
 * и карточки коллаутов (задача 124).
 *
 * Отдельно от прочего превью, и не по прихоти: замена через границу строк
 * меняет высоту документа, а такие украшения CodeMirror принимает только
 * от поля состояния — плагин их не отдаёт (Р-203). Цена — обход всего
 * дерева вместо видимых строк. Поле одно на оба вида блоков ради того же:
 * второе поле обходило бы дерево второй раз на каждую правку.
 */

/**
 * Узлы, внутри которых таблиц и блочных формул не бывает.
 *
 * Спускаться в них незачем, и это не преждевременная бережливость: поле
 * состояния обходит **всё** дерево на каждую правку и на каждое движение
 * курсора по строкам — в отличие от плагина, который знает про видимые
 * строки. Отсечь абзацы и заголовки значит оставить обход по верхним
 * блокам, а их в документе на порядок меньше.
 */
function isLeaf(name: string): boolean {
  return (
    name === 'Paragraph' ||
    name === 'FencedCode' ||
    name === 'CodeBlock' ||
    name === 'HorizontalRule' ||
    name === 'LinkReference' ||
    name === 'HTMLBlock' ||
    name === 'CommentBlock' ||
    name === 'Frontmatter' ||
    name.startsWith('ATXHeading') ||
    name.startsWith('SetextHeading')
  );
}

/**
 * Блочная формула: MathML на месте её строк, или `null`, если формула
 * показывается исходником. Единица раскрытия — блок, как у таблицы
 * (Р-184): курсор на любой её строке возвращает исходник целиком.
 *
 * Однострочная в пункте списка или в коллауте сюда не попадает — её
 * рисует плагин превью в строке (`drawsAsBlock`). Многострочная
 * в коллауте рисуется здесь, на подложке карточки (`InCard`).
 */
function mathBlock(state: EditorState, node: SyntaxNode): Range<Decoration> | null {
  const { doc } = state;
  if (!drawsAsBlock(doc, node.from, node.to)) return null;

  const first = doc.lineAt(node.from);
  const last = doc.lineAt(Math.min(Math.max(node.from, node.to - 1), doc.length));
  for (let number = first.number; number <= last.number; number += 1) {
    if (touched(state, doc.line(number))) return null;
  }

  const read = (from: number, to: number): string => doc.sliceString(from, to);
  return Decoration.replace({
    widget: new MathWidget(read(node.from, node.to), mathSource(read, node), true),
    block: true,
  }).range(first.from, last.to);
}

/** Пометка клетки поля: своего рисунка нет, только классы. */
class GutterShape extends GutterMarker {
  constructor(override readonly elementClass: string) {
    super();
  }

  /** Одинаковые классы — одна и та же пометка: клетку незачем перерисовывать. */
  override eq(other: GutterMarker): boolean {
    return other instanceof GutterShape && other.elementClass === this.elementClass;
  }
}

/**
 * Готовые украшения строк и пометки поля — по одному на набор классов.
 *
 * Поле пересобирает их на каждую правку по всему документу (Р-203),
 * а видов у них единицы: заголовок уровня N, строки карточки своего цвета.
 * Приёмка этапа 18 нашла цену сборки каждый раз заново: в заметке
 * на 4000 коллаутов и заголовков ввод с превью стал вдвое дольше, чем
 * у 0.17.0. Один объект на вид — и CodeMirror сравнивает их по ссылке.
 * Предел — на случай, если человек перебирает цвета коллаутов часами.
 */
const LINE_DECORATIONS = new Map<string, Decoration>();
const GUTTER_SHAPES = new Map<string, GutterShape>();
const MEMO_LIMIT = 1000;

function lineDecoration(classes: string, style: string | undefined): Decoration {
  const key = style === undefined ? classes : `${classes}\n${style}`;
  let found = LINE_DECORATIONS.get(key);
  if (!found) {
    if (LINE_DECORATIONS.size >= MEMO_LIMIT) LINE_DECORATIONS.clear();
    found = Decoration.line(style === undefined ? { class: classes } : { class: classes, attributes: { style } });
    LINE_DECORATIONS.set(key, found);
  }
  return found;
}

function gutterShape(classes: string): GutterShape {
  let found = GUTTER_SHAPES.get(classes);
  if (!found) {
    if (GUTTER_SHAPES.size >= MEMO_LIMIT) GUTTER_SHAPES.clear();
    found = new GutterShape(classes);
    GUTTER_SHAPES.set(classes, found);
  }
  return found;
}

/** Уровень заголовка по имени узла; нет в таблице — не заголовок. */
const HEADING_LEVEL: Readonly<Record<string, number>> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
};

/**
 * Карточка коллаута (задача 124): его строки от первой до последней
 * и вид — цвет и подложка из списка человека.
 */
interface Card {
  first: number;
  last: number;
  style: CalloutStyle;
}

/**
 * Блочный виджет внутри карточки коллаута — таблица, формула, схема.
 *
 * Замена целых строк забирает строки вместе с их украшениями, и карточка
 * рвалась на таблице: у Obsidian таблица в коллауте лежит на подложке
 * карточки, у нас лежала на фоне заметки. Обёртка несёт подложку и поля
 * карточки, а рисует содержимое сам виджет — ничего о коллаутах не зная.
 */
export class InCard extends WidgetType {
  constructor(
    readonly inner: WidgetType,
    readonly tint: string,
    /** Виджет — последнее в карточке: ему её нижнее поле и скругление. */
    readonly last: boolean,
  ) {
    super();
  }

  override eq(other: InCard): boolean {
    return (
      other instanceof InCard &&
      other.tint === this.tint &&
      other.last === this.last &&
      this.inner.eq(other.inner)
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const card = document.createElement('div');
    card.className = this.last ? 'zn-callout-block zn-callout-block-last' : 'zn-callout-block';
    card.style.setProperty('--callout-tint', this.tint);
    card.append(this.inner.toDOM(view));
    return card;
  }

  override ignoreEvent(event: Event): boolean {
    return this.inner.ignoreEvent(event);
  }

  override destroy(dom: HTMLElement): void {
    const inner = dom.firstElementChild;
    if (inner instanceof HTMLElement) this.inner.destroy(inner);
  }
}

/** Пустая строка цитаты: одни угловые скобки и пробелы. */
const BLANK_QUOTE = /^\s*(?:>\s*)*$/;

/**
 * Что собирает поле.
 *
 * `blocks` — замены целыми строками и всё, что зависит от курсора:
 * таблица, формула, схема и карточка свойств под курсором становятся
 * исходником (Р-184), а строки frontmatter исходником — шрифтом кода.
 *
 * `lines` и `gutter` — строки, у которых меняется высота или поля: воздух
 * над заголовком (задача 122), карточка коллаута (задача 124). Классу
 * строки нужна пара в поле слева — иначе стрелка свёртки и закладка стоят
 * в воздухе над текстом, а не рядом с ним: клетка поля высотой со строку,
 * и её содержимое прижато к верху. Обе половины — из одного обхода, чтобы
 * разойтись они не могли. **От курсора они не зависят** — и поэтому
 * пересчитываются после правки только там, где она прошла (см. поле).
 */
export interface BlockShapes {
  blocks: DecorationSet;
  lines: DecorationSet;
  gutter: RangeSet<GutterMarker>;
}

/** Что собирать за обход: замены, строки с полем — или то и другое. */
interface Wanted {
  blocks: boolean;
  lines: boolean;
}

/** Собранное за обход — диапазоны, строки и клетки уже по возрастанию. */
interface Walked {
  found: Range<Decoration>[];
  lines: Range<Decoration>[];
  gutter: Range<GutterMarker>[];
}

/**
 * Открытая цитата в обходе. Коллаут ли она, выясняется лениво: при сборке
 * одних замен цитата без таблицы и формулы внутри его знать не обязана,
 * а цитат в длинной заметке — тысячи.
 */
interface Quote {
  from: number;
  to: number;
  /** `undefined` — ещё не выяснено, `null` — обычная цитата. */
  card?: Card | null;
}

/** Обход дерева на отрезке `from`–`to`: только верхние блоки, которые его задевают. */
function walk(
  state: EditorState,
  callouts: CalloutLookup,
  from: number,
  to: number,
  wanted: Wanted,
): Walked {
  const found: Range<Decoration>[] = [];
  const { doc } = state;

  // Классы по началу строки: у одной строки их бывает несколько —
  // заголовок внутри карточки, её последняя строка, — а украшение строки
  // на одно место ставится одно. Ключ — начало строки, а не номер:
  // по номеру начало пришлось бы искать в документе заново для каждой
  // строки, а строк с классами в длинной заметке — тысячи.
  const lineClasses = new Map<number, string[]>();
  const gutterClasses = new Map<number, string[]>();
  const lineStyle = new Map<number, string>();
  const put = (into: Map<number, string[]>, at: number, name: string): void => {
    const names = into.get(at);
    if (!names) into.set(at, [name]);
    else if (!names.includes(name)) names.push(name);
  };
  const add = (at: number, line: string, gutter?: string): void => {
    put(lineClasses, at, line);
    if (gutter) put(gutterClasses, at, gutter);
  };

  /**
   * Строки с номерами от `first` до `last` одним проходом: начало, текст
   * и номер. Последовательное чтение вместо `doc.line` на каждую строку.
   */
  const eachLine = (
    first: number,
    last: number,
    visit: (at: number, text: string, number: number) => void,
  ): void => {
    let at = doc.line(first).from;
    let number = first;
    for (const text of doc.iterLines(first, last + 1)) {
      visit(at, text, number);
      at += text.length + 1;
      number += 1;
    }
  };

  const lastLine = (start: number, end: number): number =>
    // Шаг назад: у блока, дописанного до конца документа, `to` указывает
    // уже на начало следующей строки. Та же поправка, что у таблиц и кода.
    doc.lineAt(Math.min(Math.max(start, end - 1), doc.length)).number;

  // Открытые цитаты по глубине. Карточка — первая карточка в стопке:
  // у вложенного коллаута внутри коллаута строка иначе получила бы два
  // фона, и первый — внешний — выигрывает.
  const quotes: Quote[] = [];
  const cards: Card[] = [];
  const card = (): Card | undefined => {
    for (const quote of quotes) {
      if (quote.card === undefined) {
        const first = doc.lineAt(quote.from).number;
        const marker = parseCallout(doc.line(first).text);
        quote.card = marker
          ? { first, last: lastLine(quote.from, quote.to), style: callouts(marker.type) }
          : null;
      }
      if (quote.card) return quote.card;
    }
    return undefined;
  };

  /** Блочная замена — как есть или на подложке карточки. */
  const place = (block: Range<Decoration>): void => {
    const inside = card();
    const widget = (block.value.spec as { widget?: WidgetType }).widget;
    if (!inside || !widget) {
      found.push(block);
      return;
    }
    const last = doc.lineAt(block.to).number >= inside.last;
    found.push(
      Decoration.replace({
        widget: new InCard(widget, inside.style.tint, last),
        block: true,
      }).range(block.from, block.to),
    );
  };

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      // Строка заголовка (задача 122): воздух над ней и межстрочный
      // по уровню — свойства строки, а не куска текста. Класс остаётся
      // и под курсором: строка не прыгает, когда на неё заходят.
      // У заголовка с подчёркиванием (`===`) — строка текста, не черта.
      const level = HEADING_LEVEL[node.name];
      if (level !== undefined) {
        if (wanted.lines) {
          const at = doc.lineAt(node.from).from;
          add(at, 'zn-heading', 'zn-gutter-heading');
          add(at, `zn-heading-${level}`);
        }
        return false;
      }

      if (node.name === 'Blockquote') {
        const quote: Quote = { from: node.from, to: node.to };
        if (wanted.lines) {
          // Строкам карточки нужен ответ сразу: карточка — это они.
          const outer = card();
          quotes.push(quote);
          const own = outer ? null : card();
          if (own) {
            cards.push(own);
          } else if (outer) {
            // Цитата внутри карточки — черта акцентом по левому краю
            // текста карточки, как у Obsidian (задача 124).
            quote.card = null;
            eachLine(doc.lineAt(node.from).number, lastLine(node.from, node.to), (at) =>
              add(at, 'zn-callout-quote'),
            );
          }
        } else {
          quotes.push(quote);
        }
        return undefined;
      }

      // Frontmatter — карточкой свойств (задача 127), а исходником —
      // шрифтом кода: YAML держится отступами, и пропорциональный шрифт
      // заметки их бы сдвинул. Исходник он или карточка, решает курсор,
      // поэтому и классы его строк — среди замен.
      if (node.name === 'Frontmatter') {
        if (wanted.blocks) {
          const block = propertiesBlock(state, node.node);
          if (block) {
            place(block);
          } else {
            eachLine(doc.lineAt(node.from).number, lastLine(node.from, node.to), (at) =>
              found.push(FRONTMATTER_LINE.range(at)),
            );
          }
        }
        return false;
      }

      if (node.name === 'Table' || node.name === 'BlockMath') {
        if (wanted.blocks) {
          const block = node.name === 'Table' ? tableBlock(state, node.node) : mathBlock(state, node.node);
          if (block) place(block);
        }
        return false;
      }

      // Блок кода внутри карточки лежит на своей подложке поверх подложки
      // карточки (задача 124): до этого его строки теряли карточку целиком.
      if (wanted.lines && (node.name === 'FencedCode' || node.name === 'CodeBlock') && card()) {
        eachLine(doc.lineAt(node.from).number, lastLine(node.from, node.to), (at) =>
          add(at, 'zn-callout-code'),
        );
      }

      // Блок кода бывает схемой: ` ```mermaid ` рисуется, прочие — нет.
      if (node.name === 'FencedCode') {
        if (wanted.blocks) {
          const block = diagramBlock(state, node.node, (line) => touched(state, state.doc.line(line)));
          if (block) place(block);
        }
        return false;
      }
      if (isLeaf(node.name)) return false;
      return undefined;
    },
    leave(node) {
      if (node.name === 'Blockquote') quotes.pop();
    },
  });

  // Карточки — после обхода: зазор под заголовком зависит от следующей
  // строки, а она к моменту входа в цитату ещё не пройдена.
  for (const { first, last, style } of cards) {
    const attribute = `--callout-color: ${style.color}; --callout-tint: ${style.tint}`;
    let firstAt = -1;
    let lastAt = -1;
    // Вторая строка карточки: сразу ли за заголовком текст.
    let second: { at: number; blank: boolean } | null = null;
    eachLine(first, last, (at, text, number) => {
      add(at, 'zn-callout');
      lineStyle.set(at, attribute);
      if (number === first) {
        firstAt = at;
      } else {
        const blank = BLANK_QUOTE.test(text);
        if (blank) add(at, 'zn-callout-blank');
        if (number === first + 1) second = { at, blank };
      }
      lastAt = at;
    });
    add(firstAt, 'zn-callout-first', 'zn-gutter-callout-first');
    add(lastAt, 'zn-callout-last', 'zn-gutter-callout-last');

    // Под заголовком — отступ абзаца, если сразу за ним текст. Пустая
    // строка даёт его сама, а заголовок внутри — своим воздухом сверху.
    const next = second as { at: number; blank: boolean } | null;
    if (next && !next.blank && !lineClasses.get(next.at)?.includes('zn-heading')) {
      add(firstAt, 'zn-callout-gap', 'zn-gutter-callout-gap');
    }
  }

  // По возрастанию, без сортировки диапазонов: сортируются одни начала
  // строк, а украшения берутся готовыми.
  const lines = [...lineClasses.keys()]
    .sort((a, b) => a - b)
    .map((at) => lineDecoration(lineClasses.get(at)!.join(' '), lineStyle.get(at)).range(at));
  const gutter = [...gutterClasses.keys()]
    .sort((a, b) => a - b)
    .map((at) => gutterShape(gutterClasses.get(at)!.join(' ')).range(at));

  return { found, lines, gutter };
}

/** Строка frontmatter исходником — шрифтом кода (задача 127). */
const FRONTMATTER_LINE = Decoration.line({ class: 'zn-frontmatter' });

/** Замены — из обхода: их порядок обхода и порядок документа расходятся. */
function blocksOf(walked: Walked): DecorationSet {
  return Decoration.set(walked.found, true);
}

/** Всё блочное превью по всему документу. */
export function blockShapes(
  state: EditorState,
  /** Вид коллаутов из списка человека (задача 103). */
  callouts: CalloutLookup = lookupFor([]),
): BlockShapes {
  const walked = walk(state, callouts, 0, state.doc.length, { blocks: true, lines: true });
  return {
    blocks: blocksOf(walked),
    lines: RangeSet.of(walked.lines),
    gutter: RangeSet.of(walked.gutter),
  };
}

/** Только замены — для проверок, которым строки не нужны. */
export function blockDecorations(state: EditorState): DecorationSet {
  return blockShapes(state).blocks;
}

/**
 * Отрезок документа, где правка могла поменять строки и клетки поля.
 *
 * Края отрезка — границы верхних блоков **сразу в обоих деревьях**,
 * новом и старом: отрезок растёт, пока ни в одном из них край не режет
 * блок пополам. Одного шага мало, и это найдено тестом правками вразброс:
 * правка открыла `%%`, блок комментария в новом дереве проглотил начало
 * старой цитаты, а её остаток за краем отрезка сохранил классы карточки —
 * в новом дереве он уже простая цитата. Оба дерева нужны и порознь:
 * правка, открывшая ограду ` ``` `, тянет блок кода до конца файла
 * в новом дереве, а закрывшая — укорачивает его в старом.
 *
 * `null` — разбор отступил или края не сошлись: честно назвать отрезок
 * нельзя, и поле считает всё заново.
 */
function changedRegion(tr: Transaction): { from: number; to: number } | null {
  const before = syntaxTree(tr.startState);
  const after = syntaxTree(tr.state);

  // Дерево бывает разобрано не до конца документа, и это обычное дело:
  // CodeMirror разбирает видимое и около ста тысяч знаков за ним. Отрезок
  // тогда считается так же, только за концом дерева строк с классами нет
  // ни у старого набора, ни у нового. Дерево стало короче сдвинутого
  // старого — разбор отступил, и честно назвать отрезок нельзя.
  const oldEnd = tr.changes.mapPos(before.length, 1);
  if (after.length < oldEnd) return null;

  let from = tr.state.doc.length;
  let to = 0;
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    from = Math.min(from, fromB);
    to = Math.max(to, toB);
  });

  // Разбор ушёл дальше, чем был: новый хвост задет целиком.
  if (after.length > oldEnd) {
    from = Math.min(from, oldEnd);
    to = Math.max(to, after.length);
  }

  const back = tr.changes.invertedDesc;
  for (let round = 0; round < 64; round += 1) {
    const [newFrom, newTo] = spread(after, from, to);
    const [oldFrom, oldTo] = spread(before, back.mapPos(newFrom, -1), back.mapPos(newTo, 1));
    const nextFrom = Math.min(newFrom, tr.changes.mapPos(oldFrom, -1));
    const nextTo = Math.max(newTo, tr.changes.mapPos(oldTo, 1));
    if (nextFrom === from && nextTo === to) {
      const { doc } = tr.state;
      return {
        from: doc.lineAt(Math.max(0, Math.min(from, doc.length))).from,
        to: doc.lineAt(Math.max(0, Math.min(to, doc.length))).to,
      };
    }
    from = nextFrom;
    to = nextTo;
  }
  return null;
}

/**
 * Отрезок, дотянутый до границ верхних блоков дерева: блок, в котором
 * лежит край (или который начинается или кончается ровно на нём),
 * входит целиком. Край между блоками остаётся где был.
 */
function spread(tree: Tree, from: number, to: number): [number, number] {
  let start = from;
  let end = to;
  for (const pos of [from, to]) {
    const at = Math.max(0, Math.min(pos, tree.length));
    for (const side of [-1, 1] as const) {
      let node: SyntaxNode | null = tree.resolve(at, side);
      while (node && node.parent && node.parent.parent) node = node.parent;
      if (node && node.parent && node.from <= at && node.to >= at) {
        start = Math.min(start, node.from);
        end = Math.max(end, node.to);
      }
    }
  }
  return [start, end];
}

/**
 * Строки и клетки поля после правки: прошлые — сдвинутые сквозь правку,
 * на задетом отрезке — собранные заново.
 *
 * Найдено приёмкой этапа 18: до этого поле пересобирало их по всему
 * документу на каждое нажатие, и в заметке на мегабайт с тысячами
 * коллаутов и заголовков ввод с превью стал вдвое дольше, чем у 0.17.0.
 * Что сдвиг с частичной пересборкой даёт то же, что сборка с нуля,
 * сверяет тест правками вразброс.
 */
function afterEdit(
  value: BlockShapes,
  tr: Transaction,
  callouts: CalloutLookup,
): { lines: DecorationSet; gutter: RangeSet<GutterMarker> } | null {
  const region = changedRegion(tr);
  if (!region) return null;

  const walked = walk(tr.state, callouts, region.from, region.to, { blocks: false, lines: true });
  const inside = (at: number): boolean => at >= region.from && at <= region.to;
  const outside = (at: number): boolean => !inside(at);

  return {
    lines: value.lines.map(tr.changes).update({
      filterFrom: region.from,
      filterTo: region.to,
      filter: outside,
      add: walked.lines.filter((range) => inside(range.from)),
    }),
    gutter: value.gutter.map(tr.changes).update({
      filterFrom: region.from,
      filterTo: region.to,
      filter: outside,
      add: walked.gutter.filter((range) => inside(range.from)),
    }),
  };
}

/** Выделение поверх непрозрачной подложки кода в карточке. */
const cardSelected = Decoration.mark({ class: 'zn-card-selection' });

/**
 * Выделение в блоке кода внутри карточки (задача 124).
 *
 * Слой выделения CodeMirror лежит **под** строками (задача 100), и всё,
 * что строку заливает непрозрачно, его прячет. Подложка кода в карточке
 * непрозрачна нарочно — у Obsidian код в коллауте лежит на подложке кода,
 * а не на цвете роли, — и выделение в нём пропало бы. Поэтому здесь
 * выделенный текст таких строк красится ещё раз, куском поверх строки.
 * Только выделенные куски только этих строк: выделение в остальном тексте
 * видно и так. Строки кода в карточках — те, что поле пометило классом.
 */
export function cardSelection(state: EditorState, lines: DecorationSet): DecorationSet {
  const { doc } = state;
  const marks: Range<Decoration>[] = [];
  for (const range of state.selection.ranges) {
    if (range.empty) continue;
    lines.between(doc.lineAt(range.from).from, range.to, (at, _to, decoration) => {
      const classes = (decoration.spec as { class?: string }).class ?? '';
      if (!classes.includes('zn-callout-code')) return;
      const line = doc.lineAt(at);
      const start = Math.max(line.from, range.from);
      const end = Math.min(line.to, range.to);
      if (start < end) marks.push(cardSelected.range(start, end));
    });
  }
  return Decoration.set(marks, true);
}

/**
 * Что помнит поле: сами украшения и то, от чего они зависели.
 *
 * Второе — не кэш ради кэша, а мера, найденная приёмкой этапа 10:
 * см. `signature`.
 */
interface BlockState {
  shapes: BlockShapes;
  /** Строки, которых касается выделение. */
  signature: string;
}

/**
 * Отпечаток выделения по строкам.
 *
 * Раскрытие блока зависит не от места курсора, а от **строк**, которых
 * он касается (Р-184). Значит, движение внутри строки ничего не меняет —
 * и пересчитывать по нему нечего.
 *
 * Приёмка этапа 10 показала, во что обходится обратное: обход всего дерева
 * на каждое движение курсора стоил 0,4 мс против 0,03 мс без таблиц —
 * в десять с лишним раз больше. До кадра всё равно далеко, но платить
 * за ничего незачем.
 */
function signature(state: EditorState): string {
  const { doc } = state;
  return state.selection.ranges
    .map((range) => `${doc.lineAt(range.from).number}:${doc.lineAt(range.to).number}`)
    .join(',');
}

/**
 * Поле блочного превью — см. `blockShapes`.
 *
 * Замены пересчитываются на правку, на приезд разбора и на смену **строк**
 * выделения. Строки и клетки поля от выделения не зависят: после правки
 * они пересобираются только на задетом отрезке (`afterEdit`), а на приезд
 * разбора — целиком. Приезд разбора обязателен и найден ещё в задаче 64
 * (Р-169): язык подключается своим отсеком и позже, чем превью, и без
 * сравнения деревьев таблица оставалась бы исходником до первого нажатия.
 */
export function blockPreview(callouts: CalloutLookup = lookupFor([])): Extension {
  const field = blockField(callouts);

  // Выделение в коде внутри карточки — на каждое движение выделения,
  // а не по отпечатку строк: оно зависит от места, а не только от строк.
  // Работы тут — строки с классами внутри выделения.
  const selection = EditorView.decorations.compute([field, 'selection'], (state) =>
    cardSelection(state, state.field(field).shapes.lines),
  );

  return [field, selection];
}

/** Само поле — отдельно, чтобы тест сверял его с пересборкой с нуля. */
export function blockField(callouts: CalloutLookup = lookupFor([])): StateField<{ shapes: BlockShapes }> {
  return StateField.define<BlockState>({
    create: (state) => ({
      shapes: blockShapes(state, callouts),
      signature: signature(state),
    }),

    update(value, tr) {
      if (tr.docChanged) {
        const edited = afterEdit(value.shapes, tr, callouts);
        if (!edited) return { shapes: blockShapes(tr.state, callouts), signature: signature(tr.state) };
        const blocks = blocksOf(walk(tr.state, callouts, 0, tr.state.doc.length, { blocks: true, lines: false }));
        return { shapes: { blocks, ...edited }, signature: signature(tr.state) };
      }

      if (syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return { shapes: blockShapes(tr.state, callouts), signature: signature(tr.state) };
      }

      if (tr.selection !== undefined) {
        const next = signature(tr.state);
        if (next !== value.signature) {
          const blocks = blocksOf(walk(tr.state, callouts, 0, tr.state.doc.length, { blocks: true, lines: false }));
          return { shapes: { ...value.shapes, blocks }, signature: next };
        }
      }

      return value;
    },

    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.shapes.blocks),
      EditorView.decorations.from(field, (value) => value.shapes.lines),
      gutterLineClass.from(field, (value) => value.shapes.gutter),
    ],
  });
}
