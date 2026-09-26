import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { TreeFragment, type Tree } from '@lezer/common';

import { lookupFor } from '../src/editor/callouts';
import { hexColors } from '../src/editor/color-chips';
import { decorateLivePreview } from '../src/editor/live-preview';
import { markdownSupport } from '../src/editor/markdown-language';
import { markdownToHtml, type ConvertContext } from '../src/html/convert';

/**
 * Мелочи разметки (задача 130): коды цвета с квадратиком, сноски `[^1]`,
 * комментарии `%%…%%`.
 */

const parser = markdownSupport().language.parser;

/** Все узлы дерева: имя и отрезок. */
function nodes(tree: Tree): string[] {
  const out: string[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== 'Document') out.push(`${node.name} ${node.from}-${node.to}`);
    },
  });
  return out;
}

/** Верхние узлы дерева. */
function blocks(tree: Tree): string[] {
  const out: string[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    out.push(`${node.name} ${node.from}-${node.to}`);
  }
  return out;
}

function state(doc: string, cursor = doc.length): EditorState {
  const editor = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: markdownSupport(),
  });
  ensureSyntaxTree(editor, editor.doc.length, 5000);
  return editor;
}

/** Украшения превью: где и что — класс или «скрыто». */
function preview(doc: string, cursor = doc.length): string[] {
  const editor = state(doc, cursor);
  const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);
  const out: string[] = [];
  const iter = set.iter();
  while (iter.value !== null) {
    const spec = iter.value.spec as { class?: string; attributes?: { style?: string } };
    const what = spec.class ? `${spec.class}${spec.attributes?.style ? ` ${spec.attributes.style}` : ''}` : 'скрыто';
    out.push(`${doc.slice(iter.from, iter.to)} ${what}`);
    iter.next();
  }
  return out;
}

function context(): ConvertContext {
  return {
    callouts: lookupFor([]),
    sourcePath: 'C:\\заметки\\заметка.md',
    loadImage: async () => {
      throw new Error('нет');
    },
    loadEmbed: async () => {
      throw new Error('нет');
    },
    drawDiagram: async () => ({ error: 'нет' }),
  };
}

async function html(text: string): Promise<string> {
  return (await markdownToHtml(text, context())).html;
}

describe('коды цвета', () => {
  it('три, четыре, шесть и восемь знаков', () => {
    expect(hexColors('#abc #abcd #a1b2c3 #a1b2c3d4')).toEqual([
      { at: 0, color: '#abc' },
      { at: 5, color: '#abcd' },
      { at: 11, color: '#a1b2c3' },
      { at: 19, color: '#a1b2c3d4' },
    ]);
  });

  it('два цвета подряд — оба, как в заметке владельца', () => {
    expect(hexColors('#ff429e#706910# SLU').map((found) => found.color)).toEqual(['#ff429e', '#706910']);
  });

  it('не цвет: пять знаков, буква за кодом, не шестнадцатеричное', () => {
    expect(hexColors('#abcde #abcdefg #ggg #12345 #теги')).toEqual([]);
  });

  it('в превью — в тексте и строчном коде, но не в блоке кода и не в адресе', () => {
    const doc = [
      'Цвет #ff8800 и `#00ff00`.',
      '',
      '```css',
      'a { color: #0000ff; }',
      '```',
      '',
      '[ссылка](https://example.org/#abcdef)',
    ].join('\n');
    const chips = preview(doc, 0).filter((line) => line.includes('zn-color-chip'));
    expect(chips).toEqual(['#ff8800 zn-color-chip --chip: #ff8800', '#00ff00 zn-color-chip --chip: #00ff00']);
  });
});

describe('сноски', () => {
  it('ссылка на сноску и определение — свои узлы, а не ссылка', () => {
    const tree = parser.parse('Текст[^1].\n\n[^1]: Пояснение.\n');
    expect(nodes(tree)).toEqual([
      'Paragraph 0-10',
      'FootnoteRef 5-9',
      'FootnoteMark 5-7',
      'FootnoteLabel 7-8',
      'FootnoteMark 8-9',
      'Paragraph 12-28',
      'FootnoteDef 12-17',
      'FootnoteMark 12-14',
      'FootnoteLabel 14-15',
      'FootnoteMark 15-17',
    ]);
  });

  it('определение из одного слова — абзац, а не определение ссылки', () => {
    expect(blocks(parser.parse('[^1]: Слово\n'))).toEqual(['Paragraph 0-11']);
    // Обычное определение ссылки при этом осталось собой.
    expect(blocks(parser.parse('[a]: https://example.org\n'))).toEqual(['LinkReference 0-24']);
  });

  it('с пробелом внутри — не сноска', () => {
    expect(nodes(parser.parse('[^ нет] и [^]\n')).some((node) => node.startsWith('Footnote'))).toBe(false);
  });

  it('в превью скобки прячутся, метка — надстрочная; под курсором — исходник', () => {
    const doc = 'Текст[^note] дальше.\n\nВторая строка.';
    expect(preview(doc)).toEqual(['[^ скрыто', 'note zn-footnote', '] скрыто']);
    expect(preview(doc, 3)).toEqual([]);
  });

  it('определение в превью остаётся как написано — и второе подряд тоже', () => {
    expect(preview('[^1]: Пояснение.\n[^2]: Слово\n\nтекст')).toEqual([]);
    const tree = parser.parse('[^1]: Пояснение.\n[^2]: Слово\n');
    // Каждое определение — свой абзац.
    expect(blocks(tree)).toEqual(['Paragraph 0-16', 'Paragraph 17-28']);
    expect(nodes(tree).filter((node) => node.startsWith('FootnoteDef'))).toEqual([
      'FootnoteDef 0-5',
      'FootnoteDef 17-22',
    ]);
  });

  /**
   * Определение из одного слова со строкой продолжения — определение
   * ссылки по CommonMark: его разбор заканчивает лист раньше, чем наш
   * его увидит. Отнимать это у движка — переписывать его разбор абзаца;
   * вместо этого вывод узнаёт метку `^` и определение не теряет.
   */
  it('определение ссылки с меткой сноски в выводе не пропадает', async () => {
    expect(blocks(parser.parse('[^2]: Слово\nи дальше\n'))[0]).toMatch(/^LinkReference /);
    const out = await html('[^2]: Слово\nи дальше\n');
    expect(out).toContain('<p><sup>2</sup> Слово</p>');
    expect(out).toContain('<p>и дальше</p>');
  });

  it('в выводе — метка надстрочным знаком, определение не пропадает', async () => {
    const out = await html('Текст[^1].\n\n[^1]: Слово\n');
    expect(out).toContain('<p>Текст<sup>1</sup>.</p>');
    expect(out).toContain('<p><sup>1</sup> Слово</p>');
  });
});

describe('комментарии', () => {
  it('строчный — в абзаце, с разметкой внутри', () => {
    expect(nodes(parser.parse('а %%тайна *x*%% б\n'))).toEqual([
      'Paragraph 0-17',
      'NoteComment 2-15',
      'NoteCommentMark 2-4',
      'Emphasis 10-13',
      'EmphasisMark 10-11',
      'EmphasisMark 12-13',
      'NoteCommentMark 13-15',
    ]);
  });

  it('блоком — через пустые строки до закрывающей пары', () => {
    const text = 'До\n\n%%\nскрыто\n\nещё\n%%\n\nПосле\n';
    expect(blocks(parser.parse(text))).toEqual(['Paragraph 0-2', 'NoteCommentBlock 4-21', 'Paragraph 23-28']);
  });

  it('вторая пара на той же строке — строчный, текст за ним — текст', () => {
    expect(blocks(parser.parse('%% тайна %% явное\n'))).toEqual(['Paragraph 0-17']);
  });

  it('в цитате — не дальше цитаты', () => {
    expect(blocks(parser.parse('> %%\n> в цитате\n\nвне\n'))).toEqual(['Blockquote 0-15', 'Paragraph 17-20']);
  });

  it('одиночная пара процентов — текст', () => {
    expect(nodes(parser.parse('на 100%% уверен\n'))).toEqual(['Paragraph 0-15']);
  });

  it('в выводе комментариев нет', async () => {
    const out = await html('До %%тайна%% после.\n\n%%\nблок\n%%\n\nКонец.\n');
    expect(out).toContain('<p>До  после.</p>');
    expect(out).not.toContain('тайна');
    expect(out).not.toContain('блок');
  });

  /**
   * Блок тянется до закрывающей пары, то есть смотрит дальше следующей
   * строки. Разбор по частям обязан дать то же, что разбор с нуля:
   * иначе дописанная закрывающая пара не закрыла бы комментарий до
   * переоткрытия файла (CLAUDE.md, «Превью markdown»).
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
    const body = 'строка комментария, достаточно длинная, чтобы кусок был длиннее порога\n'.repeat(4);

    it('дописанная закрывающая пара', () => {
      const text = `Начало.\n\n%%\n${body}\n# Раздел\n\nтекст\n`;
      const at = text.indexOf('# Раздел');
      const { incremental, full } = edit(text, at, at, '%%\n\n');
      // Закрытый блок, за ним — снова заголовок, а не комментарий.
      expect(full.map((node) => node.split(' ')[0])).toEqual([
        'Paragraph',
        'NoteCommentBlock',
        'ATXHeading1',
        'Paragraph',
      ]);
      expect(incremental).toEqual(full);
    });

    it('стёртая закрывающая пара', () => {
      const text = `Начало.\n\n%%\n${body}%%\n\n# Раздел\n\nтекст\n`;
      const at = text.indexOf('%%\n\n# Раздел');
      const { incremental, full } = edit(text, at, at + 3, '');
      expect(incremental).toEqual(full);
    });
  });
});
