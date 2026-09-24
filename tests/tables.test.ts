import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

import { readTable, tableDecorations, type TableModel } from '../src/editor/tables';
import { languages } from '../src/editor/markdown-code';
import { alignmentsFrom } from '../src/html/markdown';

/**
 * Таблицы в живом превью.
 *
 * Разбор отделён от рисования нарочно: правила тут про чужой текст —
 * выравнивание двоеточиями, знаки внутри ячеек, рваные строки, — и все они
 * проверяются без окна.
 */

function state(doc: string, cursor = 0): EditorState {
  const editor = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: markdown({ base: markdownLanguage, codeLanguages: languages }),
  });
  ensureSyntaxTree(editor, editor.doc.length, 5000);
  return editor;
}

/** Разобрать первую таблицу документа. */
function parse(doc: string): TableModel | null {
  const editor = state(doc);
  let model: TableModel | null = null;

  syntaxTree(editor).iterate({
    enter(node) {
      if (node.name !== 'Table' || model) return;
      model = readTable(editor, node.node);
      return false;
    },
  });

  return model;
}

/** Текст ячейки без разметки — то, что прочтёт глаз. */
function text(cell: { html: string }): string {
  return cell.html.replace(/<[^>]+>/g, '');
}

const SIMPLE = ['| Что | Сколько |', '| --- | --- |', '| Яблоки | 5 |', '| Груши | 12 |', '', ''].join(
  '\n',
);

describe('выравнивание столбцов', () => {
  it('читается по двоеточиям', () => {
    expect(alignmentsFrom('|:---|:--:|---:|')).toEqual(['left', 'center', 'right']);
  });

  it('без двоеточий выравнивания нет', () => {
    expect(alignmentsFrom('| --- | --- |')).toEqual([null, null]);
  });

  /** Палки по краям — не столбцы, и считать их за столбцы нельзя. */
  it('крайние палки не считаются столбцами', () => {
    expect(alignmentsFrom('| --- | --- | --- |')).toHaveLength(3);
  });

  /** GFM палок по краям не требует (задача 108). */
  it('строка без крайних палок — те же столбцы', () => {
    expect(alignmentsFrom(':--|--:')).toEqual(['left', 'right']);
  });
});

describe('разбор таблицы', () => {
  it('находит заголовок и строки', () => {
    const model = parse(SIMPLE);

    expect(model).not.toBeNull();
    expect(model!.head.map(text)).toEqual(['Что', 'Сколько']);
    expect(model!.rows).toHaveLength(2);
    expect(model!.rows[0]!.map(text)).toEqual(['Яблоки', '5']);
    expect(model!.rows[1]!.map(text)).toEqual(['Груши', '12']);
  });

  /**
   * Исходник нужен виджету, чтобы понимать, менялось ли что-то: пересобирать
   * разметку таблицы на каждое движение курсора незачем.
   */
  it('запоминает исходник целиком', () => {
    const model = parse(SIMPLE);
    expect(model!.source.startsWith('| Что | Сколько |')).toBe(true);
    expect(model!.source).toContain('Груши');
  });

  /** Смещения считаются от начала таблицы: по ним щелчок ставит курсор. */
  it('помнит, где начинается каждая ячейка', () => {
    const model = parse(SIMPLE);
    const first = model!.head[0]!;

    expect(first.at).toBeGreaterThan(0);
    expect(SIMPLE.slice(first.at, first.at + 3)).toBe('Что');
  });

  it('читает выравнивание', () => {
    const doc = ['| Слева | Центр | Справа |', '|:---|:--:|---:|', '| а | б | в |', '', ''].join(
      '\n',
    );
    expect(parse(doc)!.align).toEqual(['left', 'center', 'right']);
  });

  /**
   * Знаки внутри ячейки не показываются, а действуют, — как и везде
   * в превью. Ссылка показывается своим текстом: `<a>` в окне приложения
   * увёл бы само окно по адресу. Разметку ячейки даёт вывод HTML
   * задачи 108 — тот же, что печатает заметку.
   */
  it('снимает знаки разметки внутри ячейки', () => {
    const doc = [
      '| Что | Как |',
      '| --- | --- |',
      '| **жирный** | `код` |',
      '| [ссылка](куда.md) | ~~зачёркнутый~~ |',
      '',
      '',
    ].join('\n');

    const model = parse(doc)!;

    expect(model.rows[0]!.map((cell) => cell.html)).toEqual([
      '<strong>жирный</strong>',
      '<code>код</code>',
    ]);
    expect(model.rows[1]!.map((cell) => cell.html)).toEqual(['ссылка', '<del>зачёркнутый</del>']);
  });

  /**
   * До задачи 108 у ячейки был свой разбор, и три вещи в нём расходились
   * с превью текста: вики-ссылка выходила `[ссылкой]`, `<u>` — тегами,
   * а пустая ячейка сдвигала столбцы влево.
   */
  it('вики-ссылка, строчный HTML и пустая ячейка — как в тексте', () => {
    const doc = [
      '| а | б | в |',
      '| --- | --- | --- |',
      '| [[Заметка]] |  | <u>под</u> |',
      '',
      '',
    ].join('\n');

    const model = parse(doc)!;
    expect(model.rows[0]!.map((cell) => cell.html)).toEqual(['Заметка', '', '<u>под</u>']);
  });

  /** Разметка ячейки уходит в `innerHTML`: из файла не исполняется ничего. */
  it('сырой HTML в ячейке — текстом', () => {
    const doc = ['| а |', '| --- |', '| <img src=x onerror=alert(1)> |', '', ''].join('\n');
    expect(parse(doc)!.rows[0]![0]!.html).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  /** Рваная строка — не повод отказываться от таблицы. */
  it('переживает строку короче заголовка', () => {
    const doc = ['| а | б | в |', '| --- | --- | --- |', '| один |', '', ''].join('\n');
    const model = parse(doc)!;

    expect(model.head).toHaveLength(3);
    expect(model.rows[0]!.map(text)).toEqual(['один']);
  });
});

/** Что заменено сеткой: куски текста, которых не будет на экране. */
function replaced(doc: string, cursor: number): string[] {
  const editor = state(doc, cursor);
  const set = tableDecorations(editor);
  const out: string[] = [];

  const iter = set.iter();
  while (iter.value !== null) {
    out.push(editor.doc.sliceString(iter.from, iter.to));
    iter.next();
  }
  return out;
}

describe('таблица сеткой', () => {
  const doc = SIMPLE;
  const table = doc.slice(0, doc.indexOf('| Груши | 12 |') + '| Груши | 12 |'.length);

  it('заменяется целиком, а не по строкам', () => {
    expect(replaced(doc, doc.length)).toEqual([table]);
  });

  /**
   * Единица раскрытия у блока — блок (Р-184): курсор на **любой** строке
   * возвращает исходником всю таблицу. Половина сеткой и половина исходником
   * не читается никак.
   */
  it('курсор на любой строке возвращает её целиком', () => {
    expect(replaced(doc, 3), 'первая строка').toEqual([]);
    expect(replaced(doc, doc.indexOf('| --- |') + 2), 'разделитель').toEqual([]);
    expect(replaced(doc, doc.indexOf('Груши')), 'последняя строка').toEqual([]);
  });

  /** Курсор за таблицей её не раскрывает: он её не задел. */
  it('курсор за таблицей ничего не меняет', () => {
    expect(replaced(doc, doc.length)).toHaveLength(1);
  });

  it('в документе без таблиц ничего не заменяется', () => {
    expect(replaced('# Заголовок' + String.fromCharCode(10) + String.fromCharCode(10), 0)).toEqual(
      [],
    );
  });
});
