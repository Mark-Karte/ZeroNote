import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

import { Renderer, alignmentsFrom, type Align } from '../html/markdown';
import { Source } from '../html/source';
import { lookupFor } from './callouts';
import { touched } from './live-preview';
import { wikilinkSpans } from './wikilinks';

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

/**
 * Ячейка: где начинается в документе (от начала таблицы) и что в ней.
 *
 * Содержимое — HTML строчного вывода (задача 108), того же, что печатает
 * и экспортирует заметку. До задачи 108 у ячейки был свой разбор на пять
 * тегов, и он расходился с превью текста: `[[ссылка]]` выходила `[ссылка]`,
 * `<u>` — тегами, пустая ячейка сдвигала столбцы. Одна реализация на оба
 * места — тот же довод, что у Р-222.
 */
export interface Cell {
  /** Смещение начала ячейки от начала таблицы. */
  at: number;
  /**
   * Разметка ячейки. Безопасна для `innerHTML`: весь текст экранирован,
   * сырой HTML — только белый список без атрибутов (Р-262), ссылок нет
   * (`links: false`), картинок без готовых байтов тоже — они исходником.
   */
  html: string;
}

export interface TableModel {
  align: Align[];
  head: Cell[];
  rows: Cell[][];
  /** Исходник таблицы целиком: по нему виджет понимает, менялось ли что-то. */
  source: string;
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
  const source = doc.sliceString(node.from, node.to);

  // Вывод видит только кусок таблицы, но со смещениями документа: копировать
  // всю заметку ради одной таблицы незачем. Вики-ссылки ищутся там же.
  const renderer = new Renderer(
    new Source(source, start),
    wikilinkSpans(source).map((span) => ({ ...span, from: span.from + start, to: span.to + start })),
    { images: new Map(), code: new Map() },
    {
      callouts: lookupFor([]),
      // Ссылка в окне приложения увела бы само окно по адресу.
      links: false,
      // Картинка в ячейке остаётся исходником: превью без байтов.
      missingImage: 'source',
    },
  );

  let align: Align[] = [];
  let head: Cell[] = [];
  const rows: Cell[][] = [];

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableDelimiter') {
      align = alignmentsFrom(doc.sliceString(child.from, child.to));
      continue;
    }
    if (child.name !== 'TableHeader' && child.name !== 'TableRow') continue;

    const cells = renderer.cells(child).map((cell) => ({ at: cell.at - start, html: cell.html }));
    if (child.name === 'TableHeader') {
      head = cells;
    } else {
      // Лишние ячейки сверх заголовка GFM отбрасывает — так же, как вывод
      // для печати. Недостающие сетка оставляет пустыми сама.
      if (head.length > 0) cells.length = Math.min(cells.length, head.length);
      rows.push(cells);
    }
  }

  if (head.length === 0 && rows.length === 0) return null;

  return { align, head, rows, source };
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

      // Разметка из нашего же вывода, а не из файла как есть: текст
      // экранирован, сырой HTML — белым списком без атрибутов (Р-262).
      element.innerHTML = cell.html;

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
 * Что помнит поле: сами украшения и то, от чего они зависели.
 *
 * Второе — не кэш ради кэша, а мера, найденная приёмкой этапа: см. `signature`.
 */
interface TableState {
  decorations: DecorationSet;
  /** Строки, которых касается выделение. */
  signature: string;
}

/**
 * Отпечаток выделения по строкам.
 *
 * Раскрытие таблицы зависит не от места курсора, а от **строк**, которых
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
 * Показ таблиц. Полем состояния — см. `tableDecorations`.
 *
 * Пересчёт идёт на правку, на приезд разбора и на смену **строк** выделения.
 * Второе обязательно и найдено ещё в задаче 64 (Р-169): язык подключается
 * своим отсеком и позже, чем превью, и без сравнения деревьев таблица
 * оставалась бы исходником до первого нажатия.
 */
export function tablePreview(): Extension {
  return StateField.define<TableState>({
    create: (state) => ({
      decorations: tableDecorations(state),
      signature: signature(state),
    }),

    update(value, tr) {
      if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return {
          decorations: tableDecorations(tr.state),
          signature: signature(tr.state),
        };
      }

      if (tr.selection !== undefined) {
        const next = signature(tr.state);
        if (next !== value.signature) {
          return { decorations: tableDecorations(tr.state), signature: next };
        }
      }

      return value;
    },

    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
}
