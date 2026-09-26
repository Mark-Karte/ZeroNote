import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

import { blockShapes } from '../src/editor/block-preview';

/**
 * Заголовок в заметке (задача 122): воздух над строкой и межстрочный
 * по уровню — классом строки, и такой же класс у клетки поля слева,
 * иначе стрелка свёртки встаёт в воздухе над текстом (найдено на живом
 * окне). Обе половины собирает один обход дерева — проверяется, что они
 * совпадают.
 */

function state(doc: string, cursor = 0): EditorState {
  const editor = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: markdown({ base: markdownLanguage }),
  });
  ensureSyntaxTree(editor, editor.doc.length, 5000);
  return editor;
}

/** Номер строки → класс строки заголовка. */
function lineClasses(editor: EditorState): Map<number, string> {
  const out = new Map<number, string>();
  const iter = blockShapes(editor).lines.iter();
  while (iter.value !== null) {
    const spec = iter.value.spec as { class?: string };
    if (spec.class) out.set(editor.doc.lineAt(iter.from).number, spec.class);
    iter.next();
  }
  return out;
}

/** Номера строк, чьи клетки поля помечены как заголовок. */
function gutterLines(editor: EditorState): number[] {
  const out: number[] = [];
  blockShapes(editor).gutter.between(0, editor.doc.length, (from, _to, marker) => {
    if (marker.elementClass === 'zn-gutter-heading') out.push(editor.doc.lineAt(from).number);
  });
  return out;
}

const DOC = [
  '# Первый',
  '',
  'текст',
  '',
  '### Третий',
  '',
  'Второй',
  '------',
  '',
  '> ## В цитате',
  '',
  '- ###### В пункте',
  '',
].join('\n');

describe('заголовок в заметке', () => {
  it('строка заголовка получает класс своего уровня', () => {
    expect(lineClasses(state(DOC, DOC.indexOf('текст')))).toEqual(
      new Map([
        [1, 'zn-heading zn-heading-1'],
        [5, 'zn-heading zn-heading-3'],
        // Подчёркнутый — строка текста, а не черта под ним.
        [7, 'zn-heading zn-heading-2'],
        [10, 'zn-heading zn-heading-2'],
        [12, 'zn-heading zn-heading-6'],
      ]),
    );
  });

  it('клетка поля помечена у тех же строк', () => {
    const editor = state(DOC, DOC.indexOf('текст'));
    expect(gutterLines(editor)).toEqual([...lineClasses(editor).keys()]);
  });

  /** Строка не должна прыгать, когда на неё заходит курсор. */
  it('класс остаётся и под курсором', () => {
    expect(lineClasses(state(DOC, 0)).get(1)).toBe('zn-heading zn-heading-1');
  });

  it('в блоке кода решётка — не заголовок', () => {
    const doc = '```sh\n# комментарий\n```\n';
    expect(lineClasses(state(doc, doc.length)).size).toBe(0);
    expect(gutterLines(state(doc, doc.length))).toEqual([]);
  });
});
