import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';

import { countAll, countSelection, countWords, countedFrom } from '../src/editor/word-count';

/**
 * Счётчик слов (задача 149). Правила — Obsidian 1.13, одно отличие:
 * ряд без букв и цифр — не слово.
 */

describe('слова', () => {
  it('по-русски и по-английски, с дефисом и апострофом', () => {
    expect(countWords('Кто-то сказал: «don’t panic», и всё.')).toBe(6);
    expect(countWords("don't stop")).toBe(2);
  });

  it('число с разделителями — одно слово, буквы с цифрами — тоже', () => {
    expect(countWords('Итого 1,000.50 руб за Rust1.88')).toBe(5);
  });

  it('иероглифы и кана — каждый знак словом', () => {
    expect(countWords('日本語')).toBe(3);
    expect(countWords('こんにちは')).toBe(5);
    expect(countWords('Hello 世界')).toBe(3);
  });

  /** Разметка словами не считается: решётка, звёздочки, маркер списка. */
  it('знаки разметки — не слова', () => {
    expect(countWords('# Заголовок\n\n- пункт\n- **жирный** пункт\n\n---\n')).toBe(4);
    expect(countWords(' - — \' ')).toBe(0);
    expect(countWords('')).toBe(0);
  });
});

function state(doc: string, selection?: EditorSelection): EditorState {
  const extensions = EditorState.allowMultipleSelections.of(true);
  return selection
    ? EditorState.create({ doc, selection, extensions })
    : EditorState.create({ doc, extensions });
}

describe('что считается', () => {
  const NOTE = '---\ntags: [раз, два]\ntitle: Заголовок\n---\nТекст заметки.\n';

  it('frontmatter заметки не считается — ни словами, ни знаками', () => {
    const editor = state(NOTE);
    expect(countAll(editor, true)).toEqual({ words: 2, chars: 'Текст заметки.\n'.length });
    // У простого текста frontmatter нет — считается всё: tags, раз, два,
    // title, Заголовок, Текст, заметки.
    expect(countAll(editor, false).words).toBe(7);
  });

  it('незакрытый frontmatter — текст: его сейчас пишут', () => {
    expect(countedFrom(state('---\ntags: раз\nТекст\n'), true)).toBe(0);
    // Заметка из одного frontmatter — считать нечего.
    const only = state('---\na: b\n---');
    expect(countAll(only, true)).toEqual({ words: 0, chars: 0 });
  });

  it('выделение — вместе, через перенос; пустое — нет выделения', () => {
    const doc = 'раз два три\nчетыре пять';
    expect(countSelection(state(doc))).toBeNull();
    const two = EditorSelection.create([EditorSelection.range(0, 7), EditorSelection.range(12, 18)]);
    expect(countSelection(state(doc, two))).toEqual({ words: 3, chars: 'раз два\nчетыре'.length });
  });
});
