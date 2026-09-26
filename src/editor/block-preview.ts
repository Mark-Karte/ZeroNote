import { syntaxTree } from '@codemirror/language';
import {
  RangeSet,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
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
import { tableBlock } from './tables';

/**
 * Блочное превью: всё, что заменяется целыми строками, — таблицы
 * (задача 73), блочные формулы (задача 115) и схемы mermaid (задача 117), —
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
 * Что собирает один обход дерева.
 *
 * `blocks` — замены целыми строками. `lines` и `gutter` — строки, у которых
 * меняется высота или поля: воздух над заголовком (задача 122), карточка
 * коллаута (задача 124). Классу строки нужна пара в поле слева — иначе
 * стрелка свёртки и закладка стоят в воздухе над текстом, а не рядом
 * с ним: клетка поля высотой со строку, и её содержимое прижато к верху.
 * Обе половины — из одного обхода, чтобы разойтись они не могли.
 *
 * `cardCode` — строки блоков кода внутри карточек: их подложка непрозрачна,
 * и выделение на них рисуется отдельно (`cardSelection`).
 */
export interface BlockShapes {
  blocks: DecorationSet;
  lines: DecorationSet;
  gutter: RangeSet<GutterMarker>;
  cardCode: readonly number[];
}

/** Всё блочное превью по всему документу. */
export function blockShapes(
  state: EditorState,
  /** Вид коллаутов из списка человека (задача 103). */
  callouts: CalloutLookup = lookupFor([]),
): BlockShapes {
  const found: Range<Decoration>[] = [];
  const { doc } = state;

  // Классы по номеру строки: у одной строки их бывает несколько —
  // заголовок внутри карточки, её последняя строка, — а украшение строки
  // на одно место ставится одно.
  const lineClasses = new Map<number, Set<string>>();
  const gutterClasses = new Map<number, Set<string>>();
  const lineStyle = new Map<number, string>();
  const add = (number: number, line: string, gutter?: string): void => {
    let set = lineClasses.get(number);
    if (!set) lineClasses.set(number, (set = new Set()));
    set.add(line);
    if (gutter) {
      let cells = gutterClasses.get(number);
      if (!cells) gutterClasses.set(number, (cells = new Set()));
      cells.add(gutter);
    }
  };

  // Открытые цитаты по глубине: карточка или простая цитата. Карточка —
  // первая карточка в стопке: у вложенного коллаута внутри коллаута
  // строка иначе получила бы два фона, и первый — внешний — выигрывает.
  const quotes: (Card | null)[] = [];
  const cards: Card[] = [];
  const cardCode: number[] = [];
  const card = (): Card | undefined => quotes.find((entry): entry is Card => entry !== null);

  const lastLine = (from: number, to: number): number =>
    // Шаг назад: у блока, дописанного до конца документа, `to` указывает
    // уже на начало следующей строки. Та же поправка, что у таблиц и кода.
    doc.lineAt(Math.min(Math.max(from, to - 1), doc.length)).number;

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
    enter(node) {
      // Строка заголовка (задача 122): воздух над ней и межстрочный
      // по уровню — свойства строки, а не куска текста. Класс остаётся
      // и под курсором: строка не прыгает, когда на неё заходят.
      // У заголовка с подчёркиванием (`===`) — строка текста, не черта.
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading) {
        const number = doc.lineAt(node.from).number;
        add(number, 'zn-heading', 'zn-gutter-heading');
        add(number, `zn-heading-${heading[1]}`);
        return false;
      }

      if (node.name === 'Blockquote') {
        const first = doc.lineAt(node.from).number;
        const last = lastLine(node.from, node.to);
        const outer = card();
        const marker = outer ? null : parseCallout(doc.line(first).text);
        if (marker) {
          const opened: Card = { first, last, style: callouts(marker.type) };
          cards.push(opened);
          quotes.push(opened);
        } else {
          // Цитата внутри карточки — черта акцентом по левому краю текста
          // карточки, как у Obsidian (задача 124).
          if (outer) {
            for (let number = first; number <= last; number += 1) add(number, 'zn-callout-quote');
          }
          quotes.push(null);
        }
        return undefined;
      }

      if (node.name === 'Table' || node.name === 'BlockMath') {
        const block = node.name === 'Table' ? tableBlock(state, node.node) : mathBlock(state, node.node);
        if (block) place(block);
        return false;
      }

      // Блок кода внутри карточки лежит на своей подложке поверх подложки
      // карточки (задача 124): до этого его строки теряли карточку целиком.
      if ((node.name === 'FencedCode' || node.name === 'CodeBlock') && card()) {
        const last = lastLine(node.from, node.to);
        for (let number = doc.lineAt(node.from).number; number <= last; number += 1) {
          add(number, 'zn-callout-code');
          cardCode.push(number);
        }
      }

      // Блок кода бывает схемой: ` ```mermaid ` рисуется, прочие — нет.
      if (node.name === 'FencedCode') {
        const block = diagramBlock(state, node.node, (line) => touched(state, state.doc.line(line)));
        if (block) place(block);
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
    for (let number = first; number <= last; number += 1) {
      add(number, 'zn-callout');
      lineStyle.set(number, attribute);
      if (number > first && BLANK_QUOTE.test(doc.line(number).text)) add(number, 'zn-callout-blank');
    }
    add(first, 'zn-callout-first', 'zn-gutter-callout-first');
    add(last, 'zn-callout-last', 'zn-gutter-callout-last');

    // Под заголовком — отступ абзаца, если сразу за ним текст. Пустая
    // строка даёт его сама, а заголовок внутри — своим воздухом сверху.
    const next = first + 1;
    if (
      next <= last &&
      !BLANK_QUOTE.test(doc.line(next).text) &&
      !lineClasses.get(next)?.has('zn-heading')
    ) {
      add(first, 'zn-callout-gap', 'zn-gutter-callout-gap');
    }
  }

  const lines: Range<Decoration>[] = [];
  for (const [number, classes] of lineClasses) {
    const style = lineStyle.get(number);
    const spec = style
      ? { class: [...classes].join(' '), attributes: { style } }
      : { class: [...classes].join(' ') };
    lines.push(Decoration.line(spec).range(doc.line(number).from));
  }

  const gutter: Range<GutterMarker>[] = [];
  for (const [number, classes] of gutterClasses) {
    gutter.push(new GutterShape([...classes].join(' ')).range(doc.line(number).from));
  }

  return {
    blocks: Decoration.set(found, true),
    lines: Decoration.set(lines, true),
    gutter: RangeSet.of(gutter, true),
    cardCode,
  };
}

/** Только замены — для проверок, которым строки не нужны. */
export function blockDecorations(state: EditorState): DecorationSet {
  return blockShapes(state).blocks;
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
 * видно и так.
 */
export function cardSelection(state: EditorState, codeLines: readonly number[]): DecorationSet {
  if (codeLines.length === 0) return Decoration.none;
  const { doc } = state;
  const marks: Range<Decoration>[] = [];
  for (const range of state.selection.ranges) {
    if (range.empty) continue;
    const from = doc.lineAt(range.from).number;
    const to = doc.lineAt(range.to).number;
    for (const number of codeLines) {
      if (number < from || number > to) continue;
      const line = doc.line(number);
      const start = Math.max(line.from, range.from);
      const end = Math.min(line.to, range.to);
      if (start < end) marks.push(cardSelected.range(start, end));
    }
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
 * Поле блочного превью — см. `blockDecorations`.
 *
 * Пересчёт идёт на правку, на приезд разбора и на смену **строк** выделения.
 * Второе обязательно и найдено ещё в задаче 64 (Р-169): язык подключается
 * своим отсеком и позже, чем превью, и без сравнения деревьев таблица
 * оставалась бы исходником до первого нажатия.
 */
export function blockPreview(callouts: CalloutLookup = lookupFor([])): Extension {
  const field = StateField.define<BlockState>({
    create: (state) => ({
      shapes: blockShapes(state, callouts),
      signature: signature(state),
    }),

    update(value, tr) {
      if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return {
          shapes: blockShapes(tr.state, callouts),
          signature: signature(tr.state),
        };
      }

      if (tr.selection !== undefined) {
        const next = signature(tr.state);
        if (next !== value.signature) {
          return { shapes: blockShapes(tr.state, callouts), signature: next };
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

  // Выделение в коде внутри карточки — на каждое движение выделения,
  // а не по отпечатку строк: оно зависит от места, а не только от строк.
  // Работы тут — перебор строк кода в карточках, их единицы.
  const selection = EditorView.decorations.compute([field, 'selection'], (state) =>
    cardSelection(state, state.field(field).shapes.cardCode),
  );

  return [field, selection];
}
