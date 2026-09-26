import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';

import { blockDecorations } from '../src/editor/block-preview';
import { languageLabel } from '../src/editor/code-blocks';
import { DIAGRAM_LIMIT, DiagramWidget, drawDiagram } from '../src/editor/diagram';
import type { DiagramTheme } from '../src/editor/diagram-render';
import { markdownSupport } from '../src/editor/markdown-language';

/**
 * Схемы mermaid в превью (задача 117).
 *
 * Сам mermaid без окна не рисует — ему нужен DOM, — и проверен на живом
 * окне. Здесь то, что решается без него: какие блоки становятся схемой,
 * что уходит в mermaid и где предел.
 */

function state(doc: string, cursor: number): EditorState {
  const editor = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: markdownSupport(),
  });
  ensureSyntaxTree(editor, editor.doc.length, 5000);
  return editor;
}

/** Схемы в блочном превью: что закрывают и что уходит в mermaid. */
function diagrams(doc: string, cursor: number): { covers: string; source: string }[] {
  const out: { covers: string; source: string }[] = [];
  const set = blockDecorations(state(doc, cursor));
  for (const iter = set.iter(); iter.value !== null; iter.next()) {
    const widget = iter.value.spec.widget;
    if (widget instanceof DiagramWidget) {
      out.push({ covers: doc.slice(iter.from, iter.to), source: widget.source });
    }
  }
  return out;
}

const FLOW = '```mermaid\nflowchart LR\n    A --> B\n```';

describe('какие блоки — схемы', () => {
  it('блок mermaid — схемой на месте своих строк', () => {
    const doc = `до\n\n${FLOW}\n\nпосле`;
    expect(diagrams(doc, doc.length)).toEqual([
      { covers: FLOW, source: 'flowchart LR\n    A --> B' },
    ]);
  });

  /** Р-158 и Р-184: курсор на любой строке — исходник целиком. */
  it('курсор в блоке — исходник', () => {
    const doc = `до\n\n${FLOW}\n\nпосле`;
    expect(diagrams(doc, doc.indexOf('A -->'))).toEqual([]);
    expect(diagrams(doc, doc.indexOf('```mermaid'))).toEqual([]);
  });

  it('прочий код остаётся кодом', () => {
    const doc = '```js\nconst a = 1;\n```\n\nпосле';
    expect(diagrams(doc, doc.length)).toEqual([]);
  });

  /** Замена целых строк съела бы знак пункта. */
  it('в пункте списка — исходником', () => {
    const doc = `- ${FLOW.split('\n').join('\n  ')}\n\nпосле`;
    expect(diagrams(doc, doc.length)).toEqual([]);
  });

  it('в коллауте — схемой, без знаков цитаты в тексте схемы', () => {
    const doc = '> [!note]\n> ```mermaid\n> flowchart LR\n>     A --> B\n> ```\n\nпосле';
    expect(diagrams(doc, doc.length).map((d) => d.source)).toEqual(['flowchart LR\n    A --> B']);
  });

  it('пустой блок — не схема', () => {
    const doc = '```mermaid\n```\n\nпосле';
    expect(diagrams(doc, doc.length)).toEqual([]);
  });
});

describe('подпись блока', () => {
  /** Язык узнан — «нет подсветки» было бы неправдой. */
  it('mermaid — схема, а не «нет подсветки»', () => {
    expect(languageLabel('mermaid')).toBe('схема mermaid');
    expect(languageLabel('Mermaid')).toBe('схема mermaid');
  });
});

describe('предел', () => {
  const theme = {} as DiagramTheme;

  /** Замер задачи 117: раскладка растёт быстрее размера (раздел 42). */
  it('схема длиннее предела — отказ словами, mermaid не грузится', async () => {
    const result = await drawDiagram('x'.repeat(DIAGRAM_LIMIT + 1), theme);
    expect('error' in result ? result.error : '').toMatch(/^Схема не рисуется: она длиннее 10.000 знаков/);
  });
});
