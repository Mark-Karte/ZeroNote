import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, Text } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { TreeFragment, type Tree } from '@lezer/common';

import { frontmatterLines } from '../src/editor/frontmatter';
import { decorateLivePreview } from '../src/editor/live-preview';
import { fragmentParser, markdownSupport } from '../src/editor/markdown-language';
import { outlineOf } from '../src/editor/outline';

/**
 * Frontmatter — узел разбора (задача 114, Р-274).
 *
 * До задачи превью рисовало `tags: …` над закрывающей `---` подчёркнутым
 * заголовком, а вывод HTML и оглавление держали по своему правилу.
 * Здесь — правило, его сверка с оглавлением и то, ради чего незакрытый
 * frontmatter тянется до конца: инкрементальный разбор не должен
 * оставлять устаревшее дерево.
 */

const parser = markdownSupport().language.parser;

/** Верхние узлы дерева: имя и отрезок. */
function blocks(tree: Tree): string[] {
  const out: string[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    out.push(`${node.name} ${node.from}-${node.to}`);
  }
  return out;
}

function parse(text: string): string[] {
  return blocks(parser.parse(text));
}

/** Сколько строк занимает узел `Frontmatter` по дереву; 0 — узла нет. */
function linesByTree(text: string): number {
  const first = parser.parse(text).topNode.firstChild;
  if (!first || first.name !== 'Frontmatter') return 0;
  return text.slice(first.from, first.to).split('\n').length;
}

describe('frontmatter в дереве', () => {
  /** Тот самый дефект задачи 109: `tags: …` над `---` был заголовком. */
  it('служебные поля — один узел, а не черта и заголовок', () => {
    const text = '---\ntags: [a, b]\n---\n\n# Заголовок\n';
    expect(parse(text)).toEqual(['Frontmatter 0-20', 'ATXHeading1 22-33']);
  });

  /** Внутри не разбирается ничего: YAML — не markdown. */
  it('список и решётка внутри — строки YAML', () => {
    const text = '---\naliases:\n  - Первое\n# комментарий\n---\nтело\n';
    expect(parse(text)).toEqual(['Frontmatter 0-41', 'Paragraph 42-46']);
  });

  it('закрывает строка из трёх и больше дефисов, пробелы в конце можно', () => {
    expect(parse('---\na: 1\n----- \nтело\n')).toEqual(['Frontmatter 0-15', 'Paragraph 16-20']);
  });

  it('черта не в первой строке — черта', () => {
    expect(parse('текст\n\n---\n')).toEqual(['Paragraph 0-5', 'HorizontalRule 7-10']);
    expect(parse('\n---\na: 1\n---\n')[0]).toBe('HorizontalRule 1-4');
  });

  /** Ровно `---`: у ядра так же (`markdown/front.rs`). */
  it('первая строка с пробелом после дефисов не открывает', () => {
    expect(parse('--- \na: 1\n---\n')[0]).toBe('HorizontalRule 0-4');
  });

  it('незакрытый — до конца файла, как незакрытый блок кода', () => {
    const text = '---\nбез конца\n\n# Заголовок\n';
    expect(parse(text)).toEqual([`Frontmatter 0-${text.length}`]);
  });

  /** Кусок из середины заметки — не файл: `---` в его начале черта. */
  it('разбор куска frontmatter не ищет', () => {
    const tree = fragmentParser().parse('---\nа: 1\n---\n');
    expect(blocks(tree)[0]).toBe('HorizontalRule 0-3');
  });
});

/**
 * Узел разбора и оглавление обязаны видеть одно и то же. Оглавление
 * в дерево не смотрит (оно ленивое, Р-139) — значит, правило в двух
 * местах, и сходятся они только под этим тестом.
 */
describe('дерево и оглавление видят одно', () => {
  const cases = [
    '---\ntags: [a]\n---\nтело\n',
    '---\ntags: [a]\n---',
    '---\n---\n',
    '---\na: 1\n------   \n# заголовок\n',
    '---\nбез конца\n# заголовок\n',
    '---',
    '--- \na: 1\n---\n',
    'текст\n---\nа\n---\n',
    '\n---\na\n---\n',
    '',
  ];

  for (const text of cases) {
    it(JSON.stringify(text), () => {
      expect(frontmatterLines(Text.of(text.split('\n')).iterLines())).toBe(linesByTree(text));
    });
  }

  it('заголовок внутри frontmatter в оглавление не попадает', () => {
    const doc = Text.of('---\n# не заголовок\n---\n# Заголовок'.split('\n'));
    expect(outlineOf(doc).map((heading) => heading.text)).toEqual(['Заголовок']);
  });
});

/**
 * Ради этого незакрытый frontmatter и тянется до конца файла.
 *
 * Разбор строится по частям и то, что над правкой, не перечитывает.
 * Правило «незакрытая ограда — черта» требует заглянуть до конца файла,
 * и опытом (раздел 42) нашлось: дописанная ниже закрывающая `---`
 * оставляла в дереве черту, пока файл не откроют заново.
 */
describe('инкрементальный разбор', () => {
  function edit(text: string, from: number, to: number, insert: string) {
    const before = parser.parse(text);
    const next = text.slice(0, from) + insert + text.slice(to);
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(before), [
      { fromA: from, toA: to, fromB: from, toB: from + insert.length },
    ]);
    return { incremental: blocks(parser.parse(next, fragments)), full: blocks(parser.parse(next)) };
  }

  // Длиннее 128 знаков: короче этого разбор и так начинает заново.
  const body = 'title: длинный заголовок заметки, чтобы кусок был длиннее порога\n'.repeat(4);

  it('дописанная закрывающая ограда', () => {
    const text = `---\n${body}\n# Раздел\n\nтекст\n`;
    const at = 4 + body.length;
    const { incremental, full } = edit(text, at, at, '---\n');

    expect(full[0]).toMatch(/^Frontmatter /);
    expect(incremental).toEqual(full);
  });

  it('стёртая закрывающая ограда', () => {
    const text = `---\n${body}---\n\n# Раздел\n\nтекст\n`;
    const at = 4 + body.length;
    const { incremental, full } = edit(text, at, at + 4, '');

    expect(incremental).toEqual(full);
  });

  it('правка ниже закрытого frontmatter его не трогает', () => {
    const text = `---\n${body}---\n\n# Раздел\n\nтекст\n`;
    const at = text.length - 1;
    const { incremental, full } = edit(text, at, at, ' ещё');

    expect(full[0]).toMatch(/^Frontmatter /);
    expect(incremental).toEqual(full);
  });
});

describe('превью', () => {
  function state(doc: string, cursor: number): EditorState {
    const editor = EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: markdownSupport(),
    });
    ensureSyntaxTree(editor, editor.doc.length, 5000);
    return editor;
  }

  /** Украшения превью: где стоят и что закрывают. */
  function decorations(doc: string, cursor: number): { from: number; text: string }[] {
    const editor = state(doc, cursor);
    const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);
    const out: { from: number; text: string }[] = [];
    for (const iter = set.iter(); iter.value !== null; iter.next()) {
      out.push({ from: iter.from, text: editor.doc.sliceString(iter.from, iter.to) });
    }
    return out;
  }

  /**
   * Frontmatter — исходником: ни черты вместо `---`, ни спрятанных скобок
   * у ссылки в поле. Та же ссылка в теле по-прежнему прячет скобки.
   */
  it('служебные поля — исходником, тело — превью', () => {
    const doc = '---\nup: "[[Родитель]]"\n---\n\n[[Тело]]\n\nконец';
    const body = doc.indexOf('[[Тело');

    expect(decorations(doc, doc.length)).toEqual([
      { from: body, text: '[[' },
      { from: body + 6, text: ']]' },
    ]);
  });
});
