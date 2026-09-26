import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

import { InCard, blockShapes, cardSelection } from '../src/editor/block-preview';
import { cssTintOf, lookupFor } from '../src/editor/callouts';
import { languages } from '../src/editor/markdown-code';

/**
 * Карточка коллаута (задача 124): вид Obsidian — подложка цветом роли,
 * поля, зазор под заголовком, — собранный из строк полем блочного превью
 * вместе с клетками поля слева.
 */

function state(doc: string, cursor = doc.length, anchor = cursor): EditorState {
  const editor = EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, cursor),
    extensions: markdown({ base: markdownLanguage, codeLanguages: languages }),
  });
  ensureSyntaxTree(editor, editor.doc.length, 5000);
  return editor;
}

const LIST = lookupFor([
  { id: 'bug', title: 'Баг', icon: 'md.callout-bug', color: 'danger' },
  { id: 'mine', title: 'Моё', icon: 'md.callout-note', color: '#ff8800' },
]);

/** Номер строки → классы строки. */
function lines(editor: EditorState): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const iter = blockShapes(editor, LIST).lines.iter();
  while (iter.value !== null) {
    const spec = iter.value.spec as { class?: string };
    out.set(editor.doc.lineAt(iter.from).number, (spec.class ?? '').split(' '));
    iter.next();
  }
  return out;
}

/** Номер строки → стиль строки. */
function styles(editor: EditorState): Map<number, string> {
  const out = new Map<number, string>();
  const iter = blockShapes(editor, LIST).lines.iter();
  while (iter.value !== null) {
    const spec = iter.value.spec as { attributes?: { style?: string } };
    if (spec.attributes?.style) out.set(editor.doc.lineAt(iter.from).number, spec.attributes.style);
    iter.next();
  }
  return out;
}

/** Номер строки → классы клетки поля. */
function gutter(editor: EditorState): Map<number, string> {
  const out = new Map<number, string>();
  blockShapes(editor, LIST).gutter.between(0, editor.doc.length, (from, _to, marker) => {
    out.set(editor.doc.lineAt(from).number, marker.elementClass);
  });
  return out;
}

describe('карточка коллаута', () => {
  it('получают все строки коллаута, пустая строка за ним — нет', () => {
    const shapes = lines(state('> [!tip] Совет\n> вторая строка\n\nпосле\n'));
    expect(shapes.get(1)).toEqual(
      expect.arrayContaining(['zn-callout', 'zn-callout-first', 'zn-callout-gap']),
    );
    expect(shapes.get(2)).toEqual(expect.arrayContaining(['zn-callout', 'zn-callout-last']));
    expect(shapes.has(3)).toBe(false);
  });

  /** Строка не прыгает, когда на неё заходит курсор (Р-178). */
  it('остаётся под курсором', () => {
    expect(lines(state('> [!tip] Совет\n> текст\n\n', 0)).get(1)).toContain('zn-callout');
  });

  it('обычная цитата карточки не получает', () => {
    expect([...lines(state('> просто цитата\n\n')).values()].flat()).not.toContain('zn-callout');
  });

  /**
   * Зазор под заголовком — отступ абзаца. Пустая строка даёт его сама,
   * заголовок внутри — своим воздухом: двойного отступа быть не должно.
   */
  it('зазор под заголовком — только когда за ним сразу текст', () => {
    expect(lines(state('> [!tip] Т\n> текст\n\n')).get(1)).toContain('zn-callout-gap');
    expect(lines(state('> [!tip] Т\n>\n> текст\n\n')).get(1)).not.toContain('zn-callout-gap');
    expect(lines(state('> [!tip] Т\n> ## Раздел\n\n')).get(1)).not.toContain('zn-callout-gap');
    // Коллаут из одного заголовка — сам себе первая и последняя строка.
    expect(lines(state('> [!tip] Т\n\nпосле\n')).get(1)).toEqual(
      expect.arrayContaining(['zn-callout-first', 'zn-callout-last']),
    );
  });

  it('пустая строка внутри — отступом, а не целой строкой', () => {
    expect(lines(state('> [!tip] Т\n> раз\n>\n> два\n\n')).get(3)).toContain('zn-callout-blank');
  });

  it('клетки поля получают те же поля', () => {
    const cells = gutter(state('> [!tip] Т\n> раз\n> два\n\nпосле\n'));
    expect(cells.get(1)).toBe('zn-gutter-callout-first zn-gutter-callout-gap');
    expect(cells.get(3)).toBe('zn-gutter-callout-last');
    expect(cells.has(2)).toBe(false);
  });

  it('цвет и подложка — из списка человека, свойствами строки', () => {
    const style = styles(state('> [!bug] Дефект\n> текст\n\n'));
    expect(style.get(1)).toBe(
      '--callout-color: var(--zn-color-callout-danger); --callout-tint: var(--zn-color-callout-danger-tint)',
    );
    expect(styles(state('> [!mine] Моё\n\n')).get(1)).toBe(
      '--callout-color: #ff8800; --callout-tint: rgba(255, 136, 0, 0.1)',
    );
  });

  it('цитата внутри карточки — чертой', () => {
    const shapes = lines(state('> [!failure] Т\n> > цитата\n> > дальше\n\nпосле\n'));
    expect(shapes.get(2)).toContain('zn-callout-quote');
    expect(shapes.get(3)).toContain('zn-callout-quote');
    expect(shapes.get(1)).not.toContain('zn-callout-quote');
  });

  /** До задачи 124 блок кода внутри коллаута рвал карточку. */
  it('блок кода внутри — на своей подложке поверх карточки', () => {
    const doc = '> [!tip] Т\n> ```sh\n> ls\n> ```\n> после\n\nтекст\n';
    const shapes = lines(state(doc));
    for (const number of [2, 3, 4]) {
      expect(shapes.get(number)).toEqual(expect.arrayContaining(['zn-callout', 'zn-callout-code']));
    }
    expect(shapes.get(5)).not.toContain('zn-callout-code');
  });

  it('таблица внутри — в обёртке карточки, последняя — с нижним полем', () => {
    const doc = '> [!tip] Т\n> | a | b |\n> |---|---|\n> | 1 | 2 |\n\nпосле\n';
    const widgets: InCard[] = [];
    const iter = blockShapes(state(doc), LIST).blocks.iter();
    while (iter.value !== null) {
      const widget = (iter.value.spec as { widget?: unknown }).widget;
      if (widget instanceof InCard) widgets.push(widget);
      iter.next();
    }
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.last).toBe(true);
    expect(widgets[0]!.tint).toBe(cssTintOf('accent'));
  });
});

/**
 * Выделение в коде карточки рисуется поверх (задача 124): подложка кода
 * непрозрачна, а слой выделения CodeMirror лежит под строками.
 */
describe('выделение в коде карточки', () => {
  const doc = '> [!tip] Т\n> ```sh\n> ls -la\n> ```\n\nтекст\n';

  it('красит выделенный кусок строк кода и больше ничего', () => {
    const at = doc.indexOf('ls');
    const editor = state(doc, at + 5, at);
    const marks = cardSelection(editor, blockShapes(editor, LIST).lines);
    const pieces: string[] = [];
    const iter = marks.iter();
    while (iter.value !== null) {
      pieces.push(editor.doc.sliceString(iter.from, iter.to));
      iter.next();
    }
    expect(pieces).toEqual(['ls -l']);
  });

  it('без выделения — ничего', () => {
    const editor = state(doc, doc.indexOf('ls'));
    expect(cardSelection(editor, blockShapes(editor, LIST).lines).size).toBe(0);
  });
});
