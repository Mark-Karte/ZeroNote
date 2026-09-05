import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

import { decorateQuotes } from '../src/editor/quotes';
import { highlightMark } from '../src/editor/markdown-highlight';

/**
 * Оформление markdown в исходнике (задача 57).
 *
 * Проверяется то, что можно проверить без окна: какие строки признаны
 * цитатой и что разбор видит выделение `==так==`. Как это выглядит —
 * вопрос к глазам и к снимку живого окна, а не к тесту.
 */

function state(doc: string): EditorState {
  const editor = EditorState.create({
    doc,
    extensions: markdown({
      base: markdownLanguage,
      extensions: [highlightMark],
    }),
  });
  // Без этого дерево разбора может быть ещё пустым, и тест проверит пустоту.
  ensureSyntaxTree(editor, editor.doc.length, 5000);
  return editor;
}

/** Номера строк, получивших украшение цитаты. */
function quotedLines(doc: string): number[] {
  const editor = state(doc);
  const set = decorateQuotes(editor, [{ from: 0, to: editor.doc.length }]);
  const lines: number[] = [];

  const cursor = set.iter();
  while (cursor.value !== null) {
    lines.push(editor.doc.lineAt(cursor.from).number);
    cursor.next();
  }

  return lines;
}

/** Имена узлов разбора, покрывающих указанное смещение. */
function nodesAt(doc: string, at: number): string[] {
  const editor = state(doc);
  const names: string[] = [];
  syntaxTree(editor).iterate({
    from: at,
    to: at,
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

describe('цитата', () => {
  it('размечается по строкам', () => {
    expect(quotedLines('обычный текст\n> цитата\n\nснова текст')).toEqual([2]);
  });

  /**
   * Строка без `>` сразу за цитатой — **тоже цитата**: так устроен CommonMark
   * (ленивое продолжение абзаца), и разбор здесь прав, а моё ожидание «одна
   * строка» было неверным. Украшение идёт за разбором, а не за видом строки,
   * и это не мелочь: человек видит ту границу цитаты, которую увидит любой
   * другой markdown.
   */
  it('продолжается на строку без угловой скобки', () => {
    expect(quotedLines('> цитата\nпродолжение')).toEqual([1, 2]);
  });

  it('в несколько строк размечается целиком', () => {
    expect(quotedLines('> первая\n> вторая\n> третья')).toEqual([1, 2, 3]);
  });

  /**
   * Цитата в конце документа — тот же случай, что у блоков кода: `node.to`
   * у неё указывает уже за последнюю строку, и без поправки украшение
   * уезжало бы на строку ниже.
   */
  it('в конце документа не выходит за свою последнюю строку', () => {
    expect(quotedLines('текст\n> цитата\n')).toEqual([2]);
  });

  /**
   * Вложенная цитата даёт два узла на одну строку. Без отсева по номеру
   * строки построитель диапазонов получил бы две записи на одно место
   * и упал бы — не «нарисовал бы лишнее», а именно упал.
   */
  it('вложенная не размечает строку дважды', () => {
    expect(quotedLines('> внешняя\n>> внутренняя')).toEqual([1, 2]);
  });

  it('обычный текст не трогает', () => {
    expect(quotedLines('просто строка\nи ещё одна')).toEqual([]);
  });
});

describe('выделение ==так==', () => {
  it('разбирается как свой узел', () => {
    const names = nodesAt('текст ==важное== дальше', 9);
    expect(names).toContain('Highlight');
  });

  it('знаки размечены отдельно от содержимого', () => {
    const marks = nodesAt('==важное==', 1);
    expect(marks).toContain('HighlightMark');
  });

  /** Одиночный знак равенства — это знак равенства, и трогать его нельзя. */
  it('одиночный `=` не трогает', () => {
    expect(nodesAt('let x = 1', 7)).not.toContain('Highlight');
  });

  /** `==**оба**==` — выделение с жирным внутри, а не наоборот. */
  it('пускает внутрь другую разметку', () => {
    const names = nodesAt('==**оба**==', 5);
    expect(names).toContain('Highlight');
    expect(names).toContain('StrongEmphasis');
  });
});
