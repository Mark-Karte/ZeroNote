import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { TreeFragment, type SyntaxNode, type Tree } from '@lezer/common';

import { blockDecorations } from '../src/editor/block-preview';
import { decorateLivePreview } from '../src/editor/live-preview';
import { markdownSupport } from '../src/editor/markdown-language';
import { MathWidget, loadMath, mathSource, renderMath } from '../src/editor/math';
import { toMathML } from '../src/editor/math-render';
import { lookupFor } from '../src/editor/callouts';
import { markdownToHtml } from '../src/html/convert';

/**
 * Формулы (задача 115, Р-276): разбор `$…$` и `$$…$$`, правило доллара,
 * рисование Temml, превью.
 */

const parser = markdownSupport().language.parser;

/** Формулы документа: текст узла, TeX и вид. */
function formulas(text: string): { node: string; tex: string; display: boolean }[] {
  const out: { node: string; tex: string; display: boolean }[] = [];
  const read = (from: number, to: number): string => text.slice(from, to);
  parser.parse(text).iterate({
    enter(node) {
      if (node.name !== 'InlineMath' && node.name !== 'BlockMath') return undefined;
      const math = mathSource(read, node.node);
      out.push({ node: `${node.name} ${read(node.from, node.to)}`, tex: math.tex, display: math.display });
      return false;
    },
  });
  return out;
}

/** Верхние узлы дерева: имя и отрезок. */
function blocks(tree: Tree): string[] {
  const out: string[] = [];
  for (let node: SyntaxNode | null = tree.topNode.firstChild; node; node = node.nextSibling) {
    out.push(`${node.name} ${node.from}-${node.to}`);
  }
  return out;
}

/** Проверочный набор владельца (раздел 42, «Решения владельца»). */
const OWNER = [
  'Code \\approx \\frac{V_{IN}}{V_{REF}} \\times (2^{12}-1)',
  'V_{CMP} = V_{IN} \\times \\frac{R2}{R1 + R2}',
  '\\frac{R2}{R1+R2} = 0{,}12',
];

describe('доллар — не всегда формула', () => {
  it('строчная формула', () => {
    expect(formulas('квадрат $x^2$ здесь')).toEqual([
      { node: 'InlineMath $x^2$', tex: 'x^2', display: false },
    ]);
  });

  /** Правило Pandoc: цена формулой не становится. */
  it('цены — не формула', () => {
    expect(formulas('Стоило $5, стало $10.')).toEqual([]);
    expect(formulas('от $5 до $10 и обратно')).toEqual([]);
  });

  it('пробел у доллара изнутри — не формула', () => {
    expect(formulas('$ x$ и $x $')).toEqual([]);
  });

  it('закрывающий перед цифрой — не конец', () => {
    expect(formulas('$x$5')).toEqual([]);
  });

  it('`\\$` — знак, а не граница', () => {
    expect(formulas('цена \\$5 и $x$')).toEqual([{ node: 'InlineMath $x$', tex: 'x', display: false }]);
    expect(formulas('$a\\$b$')).toEqual([{ node: 'InlineMath $a\\$b$', tex: 'a\\$b', display: false }]);
  });

  it('в коде доллар — код', () => {
    expect(formulas('`$x$` и\n\n```\n$$y$$\n```\n')).toEqual([]);
  });

  it('`$$…$$` посреди абзаца — выключная в строке', () => {
    expect(formulas('текст $$x+1$$ текст')).toEqual([
      { node: 'InlineMath $$x+1$$', tex: 'x+1', display: true },
    ]);
  });
});

describe('блочная формула', () => {
  it('три формулы владельца — три блока', () => {
    const text = OWNER.map((tex) => `$$${tex}$$`).join('\n\n');
    expect(formulas(text)).toEqual(
      OWNER.map((tex) => ({ node: `BlockMath $$${tex}$$`, tex, display: true })),
    );
  });

  it('на нескольких строках', () => {
    const text = 'до\n\n$$\na = b\n\\\\ c = d\n$$\n\nпосле\n';
    expect(formulas(text)).toEqual([
      { node: 'BlockMath $$\na = b\n\\\\ c = d\n$$', tex: 'a = b\n\\\\ c = d', display: true },
    ]);
  });

  /** Формулу пишут сразу под строкой текста — она прерывает абзац. */
  it('прерывает абзац', () => {
    expect(blocks(parser.parse('текст\n$$x$$\n'))).toEqual(['Paragraph 0-5', 'BlockMath 6-11']);
  });

  it('`$$x$$ и текст` — не блок', () => {
    expect(formulas('$$x$$ и текст')).toEqual([
      { node: 'InlineMath $$x$$', tex: 'x', display: true },
    ]);
  });

  /**
   * Сторож поля `line.depth` (внутреннее у `@lezer/markdown`): формула
   * в коллауте берёт знаки цитаты детьми, а незакрытая кончается вместе
   * с цитатой, а не тянется за неё.
   */
  it('в коллауте', () => {
    const closed = '> [!note]\n> $$\n> a = b\n> $$\n\nпосле\n';
    expect(formulas(closed).map((f) => f.tex)).toEqual(['a = b']);

    const open = '> $$\n> a = b\n\nпосле\n';
    const tree = parser.parse(open);
    expect(blocks(tree)).toEqual(['Blockquote 0-12', 'Paragraph 14-19']);
    expect(formulas(open).map((f) => f.tex)).toEqual(['a = b']);
  });

  it('незакрытая тянется до конца, как блок кода', () => {
    const text = 'до\n\n$$\na = b\n\nпосле\n';
    expect(blocks(parser.parse(text))).toEqual(['Paragraph 0-2', `BlockMath 4-${text.length}`]);
  });

  it('в пункте списка', () => {
    expect(formulas('- $$x$$\n').map((f) => f.node)).toEqual(['BlockMath $$x$$']);
  });

  /** Ради этого незакрытая и тянется до конца (Р-274 — та же причина). */
  it('дописанный ниже `$$` замечается без переоткрытия', () => {
    const body = 'a = длинная формула, чтобы кусок был длиннее порога \\\\\n'.repeat(4);
    const text = `до\n\n$$\n${body}\nпосле\n`;
    const at = text.indexOf('\nпосле');
    const before = parser.parse(text);
    const next = `${text.slice(0, at)}\n$$${text.slice(at)}`;
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(before), [
      { fromA: at, toA: at, fromB: at, toB: at + 3 },
    ]);
    expect(blocks(parser.parse(next, fragments))).toEqual(blocks(parser.parse(next)));
    expect(blocks(parser.parse(next)).some((b) => b.startsWith('Paragraph') && b.endsWith(`-${next.length - 1}`))).toBe(true);
  });
});

describe('Temml', () => {
  /** Проверочный набор владельца — первым делом. */
  it('формулы владельца рисуются', () => {
    for (const tex of OWNER) {
      const html = toMathML(tex, true);
      expect(html).toMatch(/^<math[^>]*display="block"/);
      expect(html).toContain('<mfrac>');
    }
    // `0{,}12` — «0,12» без пробела после запятой.
    expect(toMathML(OWNER[2]!, true)).toContain('<mn>0,12</mn>');
  });

  it('неразборчивый TeX — ошибка словами, а не пустое место', async () => {
    await loadMath();
    const result = renderMath('\\frac{a', false);
    expect(result && 'error' in result ? result.error : '').not.toBe('');
  });

  /** Заметка чужая (Р-202): исполняемое из TeX не выходит в разметку. */
  it('`\\href` не становится ссылкой', async () => {
    await loadMath();
    const result = renderMath('\\href{javascript:alert(1)}{x}', false);
    const html = result && 'html' in result ? result.html : '';
    expect(html).not.toContain('javascript:');
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

  /** Виджеты формул: что они закрывают. */
  function widgets(set: ReturnType<typeof blockDecorations>, doc: string): string[] {
    const out: string[] = [];
    for (const iter = set.iter(); iter.value !== null; iter.next()) {
      const widget = iter.value.spec.widget;
      if (widget instanceof MathWidget) out.push(doc.slice(iter.from, iter.to));
    }
    return out;
  }

  it('строчная — виджетом, под курсором — исходником (Р-158)', () => {
    const doc = 'формула $x^2$ здесь\n\nдругая строка';
    const away = decorateLivePreview(state(doc, doc.length), [{ from: 0, to: doc.length }], () => null, lookupFor([]));
    expect(widgets(away, doc)).toEqual(['$x^2$']);

    const on = decorateLivePreview(state(doc, 3), [{ from: 0, to: doc.length }], () => null, lookupFor([]));
    expect(widgets(on, doc)).toEqual([]);
  });

  it('блочная — полем, целыми строками; курсор на любой строке — исходник', () => {
    const doc = 'до\n\n$$\na = b\n$$\n\nпосле';
    expect(widgets(blockDecorations(state(doc, doc.length)), doc)).toEqual(['$$\na = b\n$$']);
    expect(widgets(blockDecorations(state(doc, doc.indexOf('a = b'))), doc)).toEqual([]);
  });

  /**
   * Однострочная в коллауте — тоже в строке: карточка держится на самой
   * строке, и замена строки целиком вынесла бы формулу из карточки.
   */
  it('в коллауте — в строке, карточка на месте', () => {
    const doc = ['> [!note] Физика', '> $$E = mc^2$$', '', 'после'].join('\n');
    const editor = state(doc, doc.length);
    expect(widgets(blockDecorations(editor), doc)).toEqual([]);
    expect(widgets(decorateLivePreview(editor, [{ from: 0, to: doc.length }]), doc)).toEqual([
      '$$E = mc^2$$',
    ]);
  });

  /** Замена целых строк съела бы знак пункта — такую рисует плагин в строке. */
  it('в пункте списка — в строке, знак пункта на месте', () => {
    const doc = '- $$x$$\n\nпосле';
    const editor = state(doc, doc.length);
    expect(widgets(blockDecorations(editor), doc)).toEqual([]);
    expect(widgets(decorateLivePreview(editor, [{ from: 0, to: doc.length }]), doc)).toEqual(['$$x$$']);
  });
});

describe('вывод HTML до задачи 116', () => {
  const context = {
    callouts: lookupFor([]),
    sourcePath: null,
    loadImage: async () => '',
    loadEmbed: async () => '',
  };

  /** Исчезнувшая формула хуже формулы исходником. */
  it('формула выходит как написана, а не пропадает', async () => {
    const out = await markdownToHtml('$$x^2$$\n\nи $y$ в строке\n', context);
    expect(out.html).toBe('<p class="zn-source">$$x^2$$</p>\n<p>и $y$ в строке</p>');
  });
});
