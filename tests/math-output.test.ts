import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

import { lookupFor } from '../src/editor/callouts';
import { markdownSupport } from '../src/editor/markdown-language';
import { loadMath } from '../src/editor/math';
import { readTable } from '../src/editor/tables';
import { markdownToHtml, type ConvertContext } from '../src/html/convert';
import { exportPage, mathStyles } from '../src/export/html';

/**
 * Формулы наружу (задача 116): печать, PDF, экспорт в HTML и копирование
 * получают MathML того же Temml, что у превью.
 */

const context: ConvertContext = {
  callouts: lookupFor([]),
  sourcePath: null,
  loadImage: async () => '',
  loadEmbed: async () => '',
};

/** Проверочный набор владельца (раздел 42). */
const OWNER = [
  'Code \\approx \\frac{V_{IN}}{V_{REF}} \\times (2^{12}-1)',
  'V_{CMP} = V_{IN} \\times \\frac{R2}{R1 + R2}',
  '\\frac{R2}{R1+R2} = 0{,}12',
];

describe('вывод HTML', () => {
  it('формулы владельца — MathML блоками', async () => {
    const out = await markdownToHtml(OWNER.map((tex) => `$$${tex}$$`).join('\n\n'), context);
    const blocks = out.html.split('\n').filter((line) => line.startsWith('<div class="zn-math-block"><math'));
    expect(blocks).toHaveLength(3);
    expect(out.html).toContain('<mn>0,12</mn>');
    expect(out.problems).toEqual([]);
  });

  it('строчная — в строке, рядом с текстом', async () => {
    const out = await markdownToHtml('напряжение $V_{REF}$ с делителя\n', context);
    expect(out.html).toMatch(/^<p>напряжение <span class="zn-math"><math>.*<\/math><\/span> с делителя<\/p>$/);
  });

  /** Выключная посреди абзаца — выключной разметкой, но в строке (стиль документа). */
  it('`$$…$$` посреди абзаца — выключная в строке', async () => {
    const out = await markdownToHtml('итог $$x^2$$ здесь\n', context);
    expect(out.html).toContain('<span class="zn-math"><math display="block"');
  });

  it('в ячейке таблицы', async () => {
    const out = await markdownToHtml('| a | b |\n|---|---|\n| $x^2$ | 2 |\n', context);
    expect(out.html).toContain('<td><span class="zn-math"><math>');
  });

  /**
   * Неразобранная — как написана, и это называется: на бумаге исходник
   * TeX читается как опечатка, а не как решение.
   */
  it('неразобранная — исходником и со словом о ней', async () => {
    const out = await markdownToHtml('$$\\frac{a$$\n', context);
    expect(out.html).toBe('<p class="zn-source">$$\\frac{a$$</p>');
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toContain('$$\\frac{a$$');
  });

  /** Цена не становится формулой и на бумаге. */
  it('цены — текстом', async () => {
    const out = await markdownToHtml('Стоило $5, стало $10.\n', context);
    expect(out.html).toBe('<p>Стоило $5, стало $10.</p>');
  });
});

describe('экспорт в HTML', () => {
  /** У файла соседних файлов нет: шрифт штрихов — строкой `data:`. */
  it('стиль Temml со шрифтом внутри', () => {
    const css = mathStyles();
    expect(css).toContain('math');
    expect(css).toMatch(/url\('data:font\/woff2;base64,[A-Za-z0-9+/=]+'\)/);
    expect(css).not.toContain("url('Temml.woff2')");
  });

  it('стиль формул — только если формула есть', () => {
    const tokens = { 'color-fg-default': '#1f2328' };
    expect(exportPage('<p>текст</p>', 'план', tokens)).not.toContain('data:font/woff2');
    expect(exportPage('<p><span class="zn-math"><math><mi>x</mi></math></span></p>', 'план', tokens)).toContain(
      'data:font/woff2',
    );
  });

  /** Политика файла пускает шрифт строкой — и больше ничего нового. */
  it('политика файла пускает шрифт `data:`', () => {
    const page = exportPage('<p>текст</p>', 'план', {});
    expect(page).toContain("font-src data:");
    expect(page).toContain("default-src 'none'");
  });
});

describe('ячейки таблицы в превью', () => {
  it('формула в ячейке — MathML, когда Temml загружен', async () => {
    await loadMath();
    const doc = '| a | b |\n|---|---|\n| $x^2$ | 2 |\n';
    const state = EditorState.create({ doc, extensions: markdownSupport() });
    ensureSyntaxTree(state, doc.length, 5000);
    let table = null;
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === 'Table') table = node.node;
      },
    });
    const model = readTable(state, table!);
    expect(model?.math).toBe(true);
    expect(model?.rows[0]?.[0]?.html).toContain('<math>');
  });
});
