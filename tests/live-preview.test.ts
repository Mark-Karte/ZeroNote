import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

import { decorateLivePreview, livePreviewOn } from '../src/editor/live-preview';
import { highlightMark } from '../src/editor/markdown-highlight';
import { languages } from '../src/editor/markdown-code';

/**
 * Живое превью: знаки вокруг текста.
 *
 * Проверяется без окна: сборка украшений — работа над состоянием. Главное
 * здесь — правило Р-158 (строка под курсором показывается исходником)
 * и граница между знаком вокруг текста и ограждением блока кода: и то
 * и другое зовётся `CodeMark`.
 */

function state(doc: string, cursor = 0): EditorState {
  const editor = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: [highlightMark],
    }),
  });
  ensureSyntaxTree(editor, editor.doc.length, 5000);
  return editor;
}

/** Что спрятано: куски текста, которых не будет на экране. */
function hiddenParts(doc: string, cursor = 0): string[] {
  const editor = state(doc, cursor);
  const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);
  const out: string[] = [];

  const cursorIter = set.iter();
  while (cursorIter.value !== null) {
    out.push(editor.doc.sliceString(cursorIter.from, cursorIter.to));
    cursorIter.next();
  }
  return out;
}

/** Как строка выглядит на экране: исходник минус спрятанное. */
function shown(doc: string, cursor = 0): string {
  const editor = state(doc, cursor);
  const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);

  let out = '';
  let at = 0;
  const iter = set.iter();
  while (iter.value !== null) {
    out += editor.doc.sliceString(at, iter.from);
    at = iter.to;
    iter.next();
  }
  return out + editor.doc.sliceString(at);
}

describe('живое превью: знаки вокруг текста', () => {
  it('прячет звёздочки жирного и курсива', () => {
    // Курсор в конце — на другой строке, иначе сработает правило Р-158.
    const doc = '**жирный** и *курсив*\n\n';
    expect(shown(doc, doc.length)).toBe('жирный и курсив\n\n');
  });

  it('прячет зачёркивание, выделение и обратные кавычки', () => {
    const doc = '~~снято~~ ==важно== `код`\n\n';
    expect(shown(doc, doc.length)).toBe('снято важно код\n\n');
  });

  it('строка под курсором показывается исходником (Р-158)', () => {
    const doc = '**первая**\n**вторая**\n';

    // Курсор в начале первой строки: на ней знаки видны, на второй — нет.
    expect(shown(doc, 0)).toBe('**первая**\nвторая\n');
    // Курсор на второй — наоборот.
    expect(shown(doc, doc.indexOf('вторая'))).toBe('первая\n**вторая**\n');
  });

  it('выделение через несколько строк раскрывает их все', () => {
    const doc = '**одна**\n**две**\n**три**\n';
    const editor = EditorState.create({
      doc,
      // До конца второй строки: конец выделения в начале третьей означал бы,
      // что курсор стоит на третьей, и она раскрылась бы тоже.
      selection: EditorSelection.range(0, doc.indexOf('**три**') - 1),
      extensions: markdown({ base: markdownLanguage, codeLanguages: languages }),
    });
    ensureSyntaxTree(editor, editor.doc.length, 5000);

    const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);
    // Спрятаны только знаки третьей строки: первые две задеты выделением.
    let count = 0;
    const iter = set.iter();
    while (iter.value !== null) {
      expect(editor.doc.lineAt(iter.from).number).toBe(3);
      count += 1;
      iter.next();
    }
    expect(count).toBe(2);
  });

  it('выделение, кончающееся в начале строки, раскрывает и её', () => {
    const doc = '**одна**\n**две**\n';
    const editor = EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.indexOf('**две**')),
      extensions: markdown({ base: markdownLanguage, codeLanguages: languages }),
    });
    ensureSyntaxTree(editor, editor.doc.length, 5000);

    // Курсор рисуется в начале второй строки, значит он на ней стоит,
    // и по правилу Р-158 строка показывается исходником.
    expect(decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]).size).toBe(0);
  });

  it('ограждение блока кода не трогается: там разметка и есть содержимое', () => {
    const doc = '```rust\nlet x = 1;\n```\n\nа тут `код`\n';
    // Прячутся только кавычки строчного кода — две, по одной с каждой стороны.
    expect(hiddenParts(doc, 0)).toEqual(['`', '`']);
  });

  it('знаки заголовка и цитаты остаются: это задача 65', () => {
    const doc = '# Заголовок\n\n> цитата\n\n**жирный**\n';
    expect(hiddenParts(doc, 0)).toEqual(['**', '**']);
  });

  it('вложенная разметка прячется целиком и по порядку', () => {
    const doc = '==**оба**==\n\n';
    expect(hiddenParts(doc, doc.length)).toEqual(['==', '**', '**', '==']);
    expect(shown(doc, doc.length)).toBe('оба\n\n');
  });

  it('обычный текст не трогается вовсе', () => {
    const doc = 'просто строка без разметки\n';
    expect(hiddenParts(doc, doc.length)).toEqual([]);
  });

  it('превью включается только для markdown', () => {
    expect(livePreviewOn({ livePreview: true, markdown: true })).toBe(true);
    expect(livePreviewOn({ livePreview: true, markdown: false })).toBe(false);
    expect(livePreviewOn({ livePreview: false, markdown: true })).toBe(false);
  });
});
