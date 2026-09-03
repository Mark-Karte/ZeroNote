import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

import { decorateBlocks, languageLabel } from '../src/editor/code-blocks';
import { languages } from '../src/editor/markdown-code';

/**
 * Оформление блоков кода проверяется без окна: сборка украшений — работа
 * над состоянием, и разметку виджета она не трогает.
 *
 * Главное, что здесь ловится, — границы блока. Ошибиться в них легко:
 * `node.to` у блока часто стоит уже в начале следующей строки, и без поправки
 * подложка уезжает на строку ниже закрывающего ограждения.
 */

function state(doc: string): EditorState {
  const editor = EditorState.create({
    doc,
    extensions: markdown({ base: markdownLanguage, codeLanguages: languages }),
  });
  // Без этого дерево разбора может быть ещё пустым, и тест проверит пустоту.
  ensureSyntaxTree(editor, editor.doc.length, 5000);
  return editor;
}

/** Какие строки получили какие классы. */
function classesByLine(doc: string): Map<number, string> {
  const editor = state(doc);
  const set = decorateBlocks(editor, [{ from: 0, to: editor.doc.length }]);
  const found = new Map<number, string>();

  const cursor = set.iter();
  while (cursor.value !== null) {
    const spec = cursor.value.spec as { class?: string; widget?: unknown };
    if (typeof spec.class === 'string') {
      found.set(editor.doc.lineAt(cursor.from).number, spec.class);
    }
    cursor.next();
  }

  return found;
}

/** Сколько виджетов с подписью и кнопкой построено. */
function widgetLines(doc: string): number[] {
  const editor = state(doc);
  const set = decorateBlocks(editor, [{ from: 0, to: editor.doc.length }]);
  const lines: number[] = [];

  const cursor = set.iter();
  while (cursor.value !== null) {
    const spec = cursor.value.spec as { widget?: unknown };
    if (spec.widget) lines.push(editor.doc.lineAt(cursor.from).number);
    cursor.next();
  }

  return lines;
}

const DOC = ['текст до', '```rust', 'fn main() {}', '```', 'текст после', ''].join('\n');

describe('границы блока', () => {
  it('подложку получают ограждения и всё между ними', () => {
    const classes = classesByLine(DOC);
    expect([...classes.keys()].sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  it('первая и последняя строки помечены отдельно', () => {
    const classes = classesByLine(DOC);
    expect(classes.get(2)).toContain('zn-code-block-first');
    expect(classes.get(3)).toBe('zn-code-block');
    expect(classes.get(4)).toContain('zn-code-block-last');
  });

  it('строка после закрывающего ограждения не задета', () => {
    // Ровно та ошибка, ради которой в коде стоит поправка на node.to.
    expect(classesByLine(DOC).has(5)).toBe(false);
  });

  it('недописанный блок оформляется до конца документа', () => {
    const classes = classesByLine(['```rust', 'fn main() {}', ''].join('\n'));
    expect(classes.get(1)).toContain('zn-code-block-first');
    expect(classes.get(2)).toContain('zn-code-block-last');
  });

  it('два блока подряд не сливаются', () => {
    const doc = ['```', 'а', '```', '', '```', 'б', '```', ''].join('\n');
    const classes = classesByLine(doc);
    expect([...classes.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 6, 7]);
    expect(classes.has(4)).toBe(false);
  });

  it('обычный текст без блоков не украшается', () => {
    expect(classesByLine('просто текст\nи вторая строка\n').size).toBe(0);
  });
});

describe('подпись и кнопка', () => {
  it('строятся на строке открывающего ограждения', () => {
    expect(widgetLines(DOC)).toEqual([2]);
  });

  it('строятся и у блока без языка: копировать есть что', () => {
    expect(widgetLines(['```', 'а', '```', ''].join('\n'))).toEqual([1]);
  });
});

describe('имя языка', () => {
  it('приводится к нашему названию', () => {
    expect(languageLabel('rust')).toBe('Rust');
    expect(languageLabel('cpp')).toBe('C / C++');
  });

  it('узнаётся по расширению — так подписывают на практике', () => {
    expect(languageLabel('rs')).toBe('Rust');
    expect(languageLabel('ps1')).toBe('PowerShell');
  });

  it('пустое ограждение не подписывается', () => {
    expect(languageLabel('')).toBe(null);
    expect(languageLabel('   ')).toBe(null);
  });

  it('незнакомый язык — не подпись, а признак отсутствия подсветки', () => {
    expect(languageLabel('брейнфак')).toBe(null);
  });
});
