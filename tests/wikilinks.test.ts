import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';

import { markdownSupport } from '../src/editor/markdown-language';
import { linksLive, targetAt } from '../src/editor/wikilinks';

/**
 * Где ссылки и теги живые: только в markdown и не в коде (Р-069,
 * решение владельца после задачи 114). До этого `[[nodiscard]]` в `.cpp`
 * подсвечивался висячей ссылкой, и Ctrl+щелчок создал бы заметку.
 */

function markdownState(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: markdownSupport() });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/** Что под этим местом. Представление нужно `targetAt` только ради состояния. */
function at(state: EditorState, needle: string) {
  return targetAt({ state } as EditorView, state.doc.toString().indexOf(needle) + 2);
}

describe('ссылки и теги — только в markdown и не в коде', () => {
  const doc = [
    '---',
    'up: "[[Родитель]]"',
    '---',
    'см. [[Заметка]] и #тег',
    '',
    '```cpp',
    '#include <vector>',
    '[[nodiscard]] int f();',
    '```',
    '',
    'в строке `a[[i]]` и `#define`',
  ].join('\n');

  it('в тексте заметки — ссылка и тег', () => {
    const state = markdownState(doc);
    expect(at(state, '[[Заметка')).toMatchObject({ kind: 'link', value: 'Заметка' });
    expect(at(state, '#тег')).toMatchObject({ kind: 'tag', value: 'тег' });
  });

  /** В Obsidian поле со ссылкой открывается щелчком — у нас тоже. */
  it('во frontmatter ссылка живая', () => {
    expect(at(markdownState(doc), '[[Родитель')).toMatchObject({ kind: 'link', value: 'Родитель' });
  });

  it('в блоке кода и в строчном коде — ни ссылок, ни тегов', () => {
    const state = markdownState(doc);
    expect(at(state, '[[nodiscard')).toBeNull();
    expect(at(state, '#include')).toBeNull();
    expect(at(state, '[[i]]')).toBeNull();
    expect(at(state, '#define')).toBeNull();
  });

  /** Код на C++, текст, лог — не заметки: ссылок в них нет. */
  it('вне markdown ссылок нет', () => {
    const state = EditorState.create({ doc: 'см. [[Заметка]] и #тег' });
    expect(linksLive(state)).toBe(false);
    expect(at(state, '[[Заметка')).toBeNull();
    expect(at(state, '#тег')).toBeNull();
  });
});

/**
 * Раздел в ссылке и ссылка markdown на файл (задача 148): до неё раздел
 * отбрасывался, `[[#Раздел]]` не был ссылкой вовсе, а Ctrl+щелчок
 * по `[текст](файл.md)` не делал ничего.
 */
describe('раздел и путь', () => {
  const doc = [
    'см. [[План#Итоги|итоги]] и [[#Выводы]]',
    'и [отчёт](<Архив/отчёт за год.md#Квартал%202>) и [выше](#Выводы)',
    'сайт [сюда](https://example.com#x) и [[#]]',
  ].join('\n');

  it('ссылка несёт раздел, своя заметка — пустым именем', () => {
    const state = markdownState(doc);
    expect(at(state, '[[План')).toMatchObject({ kind: 'link', value: 'План', subpath: '#Итоги' });
    expect(at(state, '[[#Выводы')).toMatchObject({ kind: 'link', value: '', subpath: '#Выводы' });
    expect(at(state, '[[#]]')).toBeNull();
  });

  it('ссылка markdown на файл — путь и раздел, раскодированные', () => {
    const state = markdownState(doc);
    expect(at(state, '[отчёт')).toMatchObject({
      kind: 'path',
      value: 'Архив/отчёт за год.md',
      subpath: '#Квартал 2',
    });
    expect(at(state, '[выше')).toMatchObject({ kind: 'path', value: '', subpath: '#Выводы' });
  });

  /** Адрес в сеть — не файл: по нему переход не ходит, как и раньше. */
  it('адрес в сеть — ничего', () => {
    expect(at(markdownState(doc), '[сюда')).toBeNull();
  });
});
