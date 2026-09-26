import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

import { decorateLivePreview } from '../src/editor/live-preview';

/**
 * Список в заметке (задача 126): раскладка Obsidian постоянными долями
 * кегля. Здесь проверяется, что каждая строка получает свой вид
 * и глубину, а знаки — своё поле; сама геометрия — в `editor.css`,
 * её видно только на живом окне.
 */

function state(doc: string, cursor = doc.length): EditorState {
  const editor = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: markdown({ base: markdownLanguage }),
  });
  ensureSyntaxTree(editor, editor.doc.length, 5000);
  return editor;
}

interface Shapes {
  /** Номер строки → классы строки и глубина. */
  lines: Map<number, { classes: string; depth: string }>;
  /** Куски текста с классом знака или отступа. */
  marks: Array<[string, string]>;
}

function shapes(doc: string, cursor = doc.length): Shapes {
  const editor = state(doc, cursor);
  const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);
  const out: Shapes = { lines: new Map(), marks: [] };
  const iter = set.iter();
  while (iter.value !== null) {
    const spec = iter.value.spec as { class?: string; attributes?: { style?: string } };
    const cls = spec.class ?? '';
    if (/\bzn-list(-cont)?\b/.test(cls) && iter.from === iter.to) {
      const depth = /--list-depth: (\d+)/.exec(spec.attributes?.style ?? '')?.[1] ?? '';
      out.lines.set(editor.doc.lineAt(iter.from).number, { classes: cls, depth });
    } else if (cls.startsWith('zn-list-')) {
      out.marks.push([cls, editor.doc.sliceString(iter.from, iter.to)]);
    }
    iter.next();
  }
  return out;
}

describe('список в заметке', () => {
  it('пункт получает вид и глубину, вложенный — на ступень глубже', () => {
    const { lines } = shapes('- раз\n  - вложенный\n1. номер\n\nпосле\n');
    expect(lines.get(1)).toEqual({ classes: 'zn-list zn-list-bullet', depth: '0' });
    expect(lines.get(2)).toEqual({ classes: 'zn-list zn-list-bullet', depth: '1' });
    expect(lines.get(3)).toEqual({ classes: 'zn-list zn-list-number', depth: '0' });
    expect(lines.has(5)).toBe(false);
  });

  it('знак — вместе с пробелами за ним, отступ — отдельно', () => {
    const { marks } = shapes('- раз\n  - вложенный\n\n');
    expect(marks).toEqual([
      ['zn-list-mark zn-list-mark-bullet', '- '],
      ['zn-list-lead', '  '],
      ['zn-list-mark zn-list-mark-bullet', '- '],
    ]);
  });

  /** Под курсором дефис виден (Р-158), поле знака — то же: строка не прыгает. */
  it('под курсором знак — исходником, в том же поле', () => {
    const { marks } = shapes('- раз\n- два\n', 0);
    expect(marks[0]).toEqual(['zn-list-mark zn-list-mark-bullet zn-list-mark-source', '- ']);
    expect(marks[1]).toEqual(['zn-list-mark zn-list-mark-bullet', '- ']);
  });

  it('строка продолжения встаёт по тексту пункта', () => {
    const { lines, marks } = shapes('- первая строка\n  продолжение\n\n');
    expect(lines.get(2)).toEqual({ classes: 'zn-list-cont zn-list-bullet', depth: '0' });
    expect(marks).toContainEqual(['zn-list-lead', '  ']);
  });

  it('задача — своим видом, дефис в узком поле', () => {
    const { lines, marks } = shapes('- [ ] купить\n\n');
    expect(lines.get(1)).toEqual({ classes: 'zn-list zn-list-task', depth: '0' });
    expect(marks[0]).toEqual(['zn-list-mark zn-list-mark-task', '- ']);
  });

  it('список в цитате — отступ считается за угловой скобкой', () => {
    const { marks } = shapes('> - раз\n>   - два\n\n');
    expect(marks).toEqual([
      ['zn-list-mark zn-list-mark-bullet', '- '],
      ['zn-list-lead', '  '],
      ['zn-list-mark zn-list-mark-bullet', '- '],
    ]);
  });
});
