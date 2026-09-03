import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { foldable, ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

/**
 * Что сворачивается — знает разбор языка, а не мы. Именно поэтому это стоит
 * проверить: своего кода тут нет, и «работает» держится на чужом устройстве,
 * которое может измениться с обновлением библиотеки.
 *
 * Заголовки markdown — главный случай в этом проекте: заметки длинные,
 * и сворачиваются в них разделы, а не фигурные скобки.
 */

function mdState(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: markdown({ base: markdownLanguage }) });
  // Разбор ленив: без этого дерево пусто, и `foldable` честно ответит «нечего».
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

/** Что свернётся, если сворачивать на этой строке (нумерация с единицы). */
function foldAtLine(state: EditorState, number: number): { from: number; to: number } | null {
  const line = state.doc.line(number);
  return foldable(state, line.from, line.to);
}

/** Свёрнутый кусок в виде текста — так проверка читается, а не считается. */
function folded(state: EditorState, number: number): string | null {
  const range = foldAtLine(state, number);
  return range ? state.sliceDoc(range.from, range.to) : null;
}

const NOTE = [
  '# Заголовок',
  '',
  'Вступление.',
  '',
  '## Раздел А',
  '',
  'Текст А.',
  '',
  '## Раздел Б',
  '',
  'Текст Б.',
].join('\n');

describe('свёртка markdown', () => {
  it('сворачивает раздел до следующего заголовка того же уровня', () => {
    const state = mdState(NOTE);
    const text = folded(state, 5);

    expect(text).not.toBeNull();
    expect(text).toContain('Текст А.');
    // Соседний раздел в свёртку не попадает — иначе это была бы не свёртка
    // раздела, а свёртка всего до конца файла.
    expect(text).not.toContain('Раздел Б');
  });

  it('заголовок верхнего уровня забирает вложенные', () => {
    const state = mdState(NOTE);
    const text = folded(state, 1);

    expect(text).toContain('Раздел А');
    expect(text).toContain('Раздел Б');
  });

  /** Строка самого заголовка остаётся видна: иначе непонятно, что свёрнуто. */
  it('оставляет строку заголовка на месте', () => {
    const state = mdState(NOTE);
    const range = foldAtLine(state, 5)!;

    expect(range.from).toBe(state.doc.line(5).to);
  });

  it('на обычной строке сворачивать нечего', () => {
    expect(foldAtLine(mdState(NOTE), 3)).toBeNull();
  });

  it('сворачивает блок кода целиком', () => {
    const state = mdState(['```rust', 'fn main() {}', '```', '', 'после'].join('\n'));
    const text = folded(state, 1);

    expect(text).toContain('fn main');
    expect(text).not.toContain('после');
  });
});
