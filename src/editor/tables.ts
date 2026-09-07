import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

import { touched } from './live-preview';

/**
 * Таблицы в живом превью markdown: `| столбец | столбец |` показывается сеткой.
 *
 * Откладывалось это с этапа 9 одним доводом: «таблица — виджет, внутри
 * которого надо править». Правило Р-184 довод снимает: **единица раскрытия
 * у блока — блок**. Курсор на любой строке таблицы возвращает её исходником
 * целиком, и правится она там как обычный текст. Править внутри виджета
 * не нужно вовсе.
 *
 * Разбор отделён от рисования: `readTable` работает над состоянием и потому
 * проверяется тестом без окна, а виджет получает готовые данные и только
 * строит из них разметку.
 */

/** Как выровнен столбец. `null` — как получится, то есть по левому краю. */
export type Align = 'left' | 'center' | 'right' | null;

/** Кусок ячейки: текст и тег, в который его завернуть. */
export interface CellPart {
  text: string;
  /** `null` — обычный текст. */
  tag: string | null;
}

export interface Cell {
  /** Смещение начала ячейки от начала таблицы. */
  at: number;
  parts: CellPart[];
}

export interface TableModel {
  align: Align[];
  head: Cell[];
  rows: Cell[][];
  /** Исходник таблицы целиком: по нему виджет понимает, менялось ли что-то. */
  source: string;
}

/**
 * Разметка внутри ячейки, которую превью показывает, а не пишет.
 *
 * Список короче, чем у строчного превью в тексте, и это сознательно: ячейка —
 * место для слова, а не для абзаца. Вложенность разбирается на один уровень;
 * `**жирный с `кодом`**` покажет код обычными знаками внутри жирного. Ошибкой
 * это не будет — так в файле и написано.
 */
const TAG: Record<string, string> = {
  StrongEmphasis: 'strong',
  Emphasis: 'em',
  Strikethrough: 'del',
  Highlight: 'mark',
  InlineCode: 'code',
};

/** Знаки, которые внутри этих узлов не показываются. */
const MARKS = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  'HighlightMark',
  'CodeMark',
  'LinkMark',
  'URL',
]);

/**
 * Как записано выравнивание в разделительной строке.
 *
 * `|:---|:--:|---:|` — левое, по центру, правое. Чистая функция: правило
 * маленькое, а ошибиться в двоеточиях легко.
 */
export function alignmentsFrom(delimiter: string): Align[] {
  return delimiter
    .split('|')
    // Крайние пустые куски — от палок по краям строки, а не столбцы.
    .slice(1, -1)
    .map((part) => {
      const text = part.trim();
      const left = text.startsWith(':');
      const right = text.endsWith(':');

      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return null;
    });
}

/**
 * Прочитать таблицу из дерева разбора.
 *
 * `null` — узел не таблица или в нём нет ни одной строки: рисовать сетку
 * из ничего мы не будем.
 */
export function readTable(state: EditorState, node: SyntaxNode): TableModel | null {
  const start = node.from;
  const { doc } = state;

  let align: Align[] = [];
  let head: Cell[] = [];
  const rows: Cell[][] = [];

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableDelimiter') {
      align = alignmentsFrom(doc.sliceString(child.from, child.to));
      continue;
    }
    if (child.name !== 'TableHeader' && child.name !== 'TableRow') continue;

    const cells = readRow(state, child, start);
    if (child.name === 'TableHeader') head = cells;
    else rows.push(cells);
  }

  if (head.length === 0 && rows.length === 0) return null;

  return {
    align,
    head,
    rows,
    source: doc.sliceString(node.from, node.to),
  };
}

function readRow(state: EditorState, row: SyntaxNode, start: number): Cell[] {
  const cells: Cell[] = [];

  for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
    if (cell.name !== 'TableCell') continue;
    cells.push({ at: cell.from - start, parts: readCell(state, cell) });
  }

  return cells;
}

/**
 * Разобрать ячейку на куски.
 *
 * Внутрь известных узлов не спускаемся: нужен их текст без знаков, а не их
 * устройство. Ссылка показывается своим текстом — как и в обычном превью.
 */
function readCell(state: EditorState, cell: SyntaxNode): CellPart[] {
  const parts: CellPart[] = [];
  const { doc } = state;
  let pos = cell.from;

  const plain = (to: number): void => {
    if (to > pos) parts.push({ text: doc.sliceString(pos, to), tag: null });
  };

  syntaxTree(state).iterate({
    from: cell.from,
    to: cell.to,
    enter(node) {
      if (node.from < cell.from || node.to > cell.to) return;

      const tag = TAG[node.name];
      const link = node.name === 'Link';
      if (!tag && !link) return;

      plain(node.from);
      parts.push({ text: withoutMarks(state, node.node), tag: tag ?? null });
      pos = node.to;
      return false;
    },
  });

  plain(cell.to);
  return parts;
}

/** Текст узла без своих знаков разметки. */
function withoutMarks(state: EditorState, node: SyntaxNode): string {
  const { doc } = state;
  let text = '';
  let pos = node.from;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!MARKS.has(child.name)) continue;
    if (child.from > pos) text += doc.sliceString(pos, child.from);
    pos = child.to;
  }

  if (pos < node.to) text += doc.sliceString(pos, node.to);
  return text.trim();
}

/**
 * Разобранные таблицы по их исходнику.
 *
 * Украшения пересобираются на каждое движение курсора (Р-158), а разбор
 * таблицы в полсотни строк — это обход полусотни узлов. Дешевле помнить,
 * тем более что ключ у нас уже есть: исходник таблицы и так нужен виджету,
 * чтобы понимать, менялось ли что-то.
 */
const parsed = new Map<string, TableModel>();
const PARSED_LIMIT = 8;

export function tableAt(state: EditorState, node: SyntaxNode): TableModel | null {
  const source = state.doc.sliceString(node.from, node.to);
  const known = parsed.get(source);
  if (known) return known;

  const model = readTable(state, node);
  if (!model) return null;

  parsed.set(source, model);
  if (parsed.size > PARSED_LIMIT) {
    const oldest = parsed.keys().next();
    if (!oldest.done) parsed.delete(oldest.value);
  }
  return model;
}

/**
 * Таблица сеткой.
 *
 * Блочный виджет: таблица занимает целые строки, и заменять её кусками
 * посреди строки нечем. Щелчок по ячейке ставит курсор в неё — и таблица
 * тут же становится исходником, потому что курсор её задел (Р-184). Так
 * и правится: щёлкнул в ячейку, поправил текст, ушёл — снова сетка.
 */
export class TableWidget extends WidgetType {
  constructor(
    readonly model: TableModel,
    /** Начало таблицы в документе: смещения ячеек считаются от него. */
    readonly start: number,
  ) {
    super();
  }

  /**
   * Сравнивается и исходник, и место: текст мог не измениться, а таблица —
   * уехать вниз от правки выше, и тогда щелчок по ячейке ставил бы курсор
   * не туда.
   */
  override eq(other: TableWidget): boolean {
    return other.model.source === this.model.source && other.start === this.start;
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div');
    box.className = 'zn-table';

    const table = document.createElement('table');
    box.append(table);

    if (this.model.head.length > 0) {
      const head = document.createElement('thead');
      head.append(this.row(view, this.model.head, 'th'));
      table.append(head);
    }

    const body = document.createElement('tbody');
    for (const cells of this.model.rows) {
      body.append(this.row(view, cells, 'td'));
    }
    table.append(body);

    return box;
  }

  private row(view: EditorView, cells: Cell[], tag: 'th' | 'td'): HTMLElement {
    const row = document.createElement('tr');

    cells.forEach((cell, index) => {
      const element = document.createElement(tag);
      const align = this.model.align[index];
      if (align) element.style.textAlign = align;

      for (const part of cell.parts) {
        if (part.tag === null) {
          element.append(part.text);
        } else {
          const wrap = document.createElement(part.tag);
          wrap.textContent = part.text;
          element.append(wrap);
        }
      }

      const at = this.start + cell.at;
      element.addEventListener('mousedown', (event) => {
        // Своё нажатие, а не общее: место щелчка внутри виджета редактор
        // сам в позицию документа не переводит — он знает только про саму
        // таблицу, а не про её ячейки.
        event.preventDefault();
        view.dispatch({ selection: { anchor: at } });
        view.focus();
      });

      row.append(element);
    });

    return row;
  }

  /** Нажатия обрабатываем сами — см. `row`. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Узлы, внутри которых таблицы не бывает.
 *
 * Спускаться в них незачем, и это не преждевременная бережливость: поле
 * состояния обходит **всё** дерево на каждую правку и на каждое движение
 * курсора — в отличие от плагина, который знает про видимые строки. Отсечь
 * абзацы и заголовки значит оставить обход по верхним блокам, а их
 * в документе на порядок меньше.
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
    name.startsWith('ATXHeading') ||
    name.startsWith('SetextHeading')
  );
}

/**
 * Украшения таблиц: каждая заменяется сеткой целиком.
 *
 * Отдельно от прочего превью, и не по прихоти: замена через границу строк
 * меняет высоту документа, а такие украшения CodeMirror принимает только
 * от поля состояния — плагин их не отдаёт. Отсюда и цена, названная выше:
 * обход всего дерева вместо видимых строк.
 */
export function tableDecorations(state: EditorState): DecorationSet {
  const found: Range<Decoration>[] = [];
  const { doc } = state;

  syntaxTree(state).iterate({
    enter(node) {
      if (isLeaf(node.name)) return false;
      if (node.name !== 'Table') return;

      const first = doc.lineAt(node.from);
      // Шаг назад: у таблицы, дописанной до конца документа, `node.to`
      // указывает уже на начало следующей строки. Та же поправка,
      // что у цитат и блоков кода.
      const last = doc.lineAt(Math.min(Math.max(node.from, node.to - 1), doc.length));

      // Единица раскрытия — блок, а не строка (Р-184): курсор на любой
      // строке таблицы возвращает исходником её целиком. Половина сеткой
      // и половина исходником не читается никак.
      for (let number = first.number; number <= last.number; number += 1) {
        if (touched(state, doc.line(number))) return false;
      }

      const model = tableAt(state, node.node);
      if (!model) return false;

      found.push(
        Decoration.replace({
          widget: new TableWidget(model, node.from),
          block: true,
        }).range(first.from, last.to),
      );
      return false;
    },
  });

  return Decoration.set(found, true);
}

/**
 * Показ таблиц. Полем состояния — см. `tableDecorations`.
 *
 * Пересчёт идёт на правку, на смену выделения и на приезд разбора. Последнее
 * обязательно и найдено ещё в задаче 64 (Р-169): язык подключается своим
 * отсеком и позже, чем превью, и без сравнения деревьев таблица оставалась бы
 * исходником до первого нажатия.
 */
export function tablePreview(): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => tableDecorations(state),

    update(value, tr) {
      if (
        tr.docChanged ||
        tr.selection !== undefined ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state)
      ) {
        return tableDecorations(tr.state);
      }
      return value;
    },

    provide: (field) => EditorView.decorations.from(field),
  });
}
