import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';

import { blockShapes } from '../src/editor/block-preview';
import { markdownSupport } from '../src/editor/markdown-language';
import {
  PropertiesWidget,
  readFlowList,
  readProperties,
  readScalar,
} from '../src/editor/properties';

/**
 * Свойства — frontmatter карточкой (задача 127): узкий разбор, только
 * показ, всё непонятное — исходником целиком.
 */

describe('разбор значения', () => {
  it('снимает кавычки и комментарий, пустое — пусто', () => {
    expect(readScalar('в работе')).toBe('в работе');
    expect(readScalar('"в работе"')).toBe('в работе');
    expect(readScalar("'it''s'")).toBe("it's");
    expect(readScalar('draft # потом')).toBe('draft');
    expect(readScalar('C#')).toBe('C#');
    expect(readScalar('~')).toBe('');
    expect(readScalar('null')).toBe('');
    expect(readScalar('')).toBe('');
  });

  it('не толкует то, чего не понимает', () => {
    expect(readScalar('"a\\nb"')).toBeNull();
    expect(readScalar('"незакрытая')).toBeNull();
    expect(readScalar('|')).toBeNull();
    expect(readScalar('>-')).toBeNull();
    expect(readScalar('&anchor value')).toBeNull();
    expect(readScalar('*anchor')).toBeNull();
    expect(readScalar('{a: 1}')).toBeNull();
  });

  it('список в строку', () => {
    expect(readFlowList('[a, b]')).toEqual(['a', 'b']);
    expect(readFlowList('["a, b", c]')).toEqual(['a, b', 'c']);
    expect(readFlowList('[]')).toEqual([]);
    expect(readFlowList('[a, b,]')).toEqual(['a', 'b']);
    expect(readFlowList('[a, [b]]')).toBeNull();
    expect(readFlowList('[a, b] лишнее')).toBeNull();
  });
});

describe('разбор свойств', () => {
  it('заметка владельца: теги списком, дата, текст', () => {
    const properties = readProperties([
      'tags:',
      '  - homelab',
      '  - obsidian',
      'created: 2026-09-24',
      'status: в работе',
    ]);
    expect(properties).toEqual([
      { key: 'tags', kind: 'tags', values: ['homelab', 'obsidian'], line: 1 },
      { key: 'created', kind: 'date', values: ['2026-09-24'], line: 4 },
      { key: 'status', kind: 'text', values: ['в работе'], line: 5 },
    ]);
  });

  it('тип — по ключу и по виду значения', () => {
    const kinds = readProperties([
      'aliases: [Первая, Вторая]',
      'links:',
      '- a',
      'count: 42',
      'ratio: -1.5e3',
      'done: true',
      'when: 2026-09-27T10:30',
      'title: "Заметка"',
      'empty:',
    ])?.map((property) => [property.key, property.kind]);
    expect(kinds).toEqual([
      ['aliases', 'aliases'],
      ['links', 'list'],
      ['count', 'number'],
      ['ratio', 'number'],
      ['done', 'checkbox'],
      ['when', 'datetime'],
      ['title', 'text'],
      ['empty', 'text'],
    ]);
  });

  it('теги строкой — тоже список, решётка прячется', () => {
    expect(readProperties(['tags: "#a, b c"'])?.[0]?.values).toEqual(['a', 'b', 'c']);
    expect(readProperties(['tags: [#a, b]'])?.[0]?.values).toEqual(['a', 'b']);
  });

  it('пустые строки и комментарии пропускаются', () => {
    const properties = readProperties(['# заметка', '', 'a: 1', '  # между', 'b: 2']);
    expect(properties?.map((property) => property.key)).toEqual(['a', 'b']);
  });

  it('вложенный словарь, продолжение строки, многострочное — исходником', () => {
    expect(readProperties(['meta:', '  author: я'])).toBeNull();
    expect(readProperties(['title: длинное', '  продолжение'])).toBeNull();
    expect(readProperties(['text: |', '  строка'])).toBeNull();
    expect(readProperties(['list:', '  - [a]'])).toBeNull();
    expect(readProperties(['- корень списком'])).toBeNull();
    expect(readProperties(['"ключ": 1'])).toBeNull();
    expect(readProperties(['key:value'])).toBeNull();
  });
});

describe('карточка в превью', () => {
  const NOTE = [
    '---',
    'tags:',
    '  - homelab',
    'created: 2026-09-24',
    '---',
    '',
    '# Заголовок',
    '',
    'Текст.',
  ].join('\n');

  function state(doc: string, cursor: number): EditorState {
    const editor = EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: markdownSupport(),
    });
    ensureSyntaxTree(editor, editor.doc.length, 5000);
    return editor;
  }

  /** Карточка: откуда докуда и что в ней; `null` — её нет. */
  function card(editor: EditorState): { from: number; to: number; widget: PropertiesWidget } | null {
    const iter = blockShapes(editor).blocks.iter();
    while (iter.value !== null) {
      const widget = (iter.value.spec as { widget?: unknown }).widget;
      if (widget instanceof PropertiesWidget) return { from: iter.from, to: iter.to, widget };
      iter.next();
    }
    return null;
  }

  /** Строки с классом исходника frontmatter. */
  /** Строки с классом исходника frontmatter — он среди замен: его решает курсор. */
  function sourceLines(editor: EditorState): number[] {
    const out: number[] = [];
    const iter = blockShapes(editor).blocks.iter();
    while (iter.value !== null) {
      const spec = iter.value.spec as { class?: string };
      if ((spec.class ?? '').split(' ').includes('zn-frontmatter')) {
        out.push(editor.doc.lineAt(iter.from).number);
      }
      iter.next();
    }
    return out;
  }

  it('вне курсора — карточка на месте всех строк frontmatter', () => {
    const editor = state(NOTE, NOTE.length);
    const found = card(editor);
    expect(found).not.toBeNull();
    expect(found?.from).toBe(0);
    expect(found?.to).toBe(editor.doc.line(5).to);
    expect(found?.widget.properties.map((property) => property.key)).toEqual(['tags', 'created']);
    // Щелчок по свойству ставит курсор в конец строки его ключа.
    expect(found?.widget.ends[0]).toBe(editor.doc.line(2).to);
    expect(found?.widget.ends[2]).toBe(editor.doc.line(4).to);
    expect(sourceLines(editor)).toEqual([]);
  });

  it('курсор на любой строке — исходник целиком, шрифтом кода', () => {
    for (const line of [1, 3, 5]) {
      const editor = state(NOTE, state(NOTE, 0).doc.line(line).from);
      expect(card(editor), `строка ${line}`).toBeNull();
      expect(sourceLines(editor)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it('незакрытый, пустой и непонятный — исходником', () => {
    const unclosed = '---\ntags: a\n';
    expect(card(state(unclosed, 0 + unclosed.length))).toBeNull();

    const empty = '---\n---\n\nТекст.';
    expect(card(state(empty, empty.length))).toBeNull();

    const nested = '---\nmeta:\n  author: я\n---\n\nТекст.';
    const editor = state(nested, nested.length);
    expect(card(editor)).toBeNull();
    expect(sourceLines(editor)).toEqual([1, 2, 3, 4]);
  });

  it('текст файла не меняется: карточка — только украшение', () => {
    const editor = state(NOTE, NOTE.length);
    expect(card(editor)).not.toBeNull();
    expect(editor.doc.toString()).toBe(NOTE);
  });
});
