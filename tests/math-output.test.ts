import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

import { lookupFor } from '../src/editor/callouts';
import { markdownSupport } from '../src/editor/markdown-language';
import { loadMath } from '../src/editor/math';
import { readTable } from '../src/editor/tables';
import { markdownToHtml, type ConvertContext } from '../src/html/convert';
import { mathStyles, withoutTemmlFont } from '../src/editor/math-style';
import { exportPage } from '../src/export/html';

/**
 * Формулы наружу (задача 116): печать, PDF, экспорт в HTML и копирование
 * получают MathML того же Temml, что у превью.
 */

const context: ConvertContext = {
  callouts: lookupFor([]),
  sourcePath: null,
  loadImage: async () => '',
  loadEmbed: async () => '',
  drawDiagram: async () => ({ error: 'mermaid без окна не рисует' }),
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

describe('стиль формул', () => {
  /**
   * Шрифт Temml помечен «не для коммерческого использования» (Р-280):
   * ни `@font-face`, ни ссылок на файл, ни назначения его имени.
   */
  it('таблица Temml — без его шрифта', () => {
    const css = mathStyles();
    expect(css).toContain('math');
    // Выравнивание столбцов `aligned` — ради него таблица и нужна.
    expect(css).toContain('.tml-right');
    expect(css).not.toContain('@font-face');
    // Ссылок на файлы шрифтов нет; картинки `data:` (стрелка `\cancel`) — свои.
    expect(css).not.toMatch(/url\(["']?[\w.-]+\.(woff2?|ttf|otf)/);
    expect(css).not.toMatch(/font-family:\s*["']?Temml/);
    expect(css).not.toContain('woff2');
  });

  /** Правило удаляется целиком, соседние правила целы. */
  it('вырезается только назначение шрифта', () => {
    const css = [
      "@font-face { font-family: 'Temml'; src: url('Temml.woff2'); }",
      'math .mathscr { font-family: "Temml"; }',
      '.keep { color: red; }',
      '@supports (x) {',
      '  mo.tml-prime { font-family: Temml; }',
      '  .pad { padding-left: 0.05em; }',
      '}',
    ].join('\n');
    const out = withoutTemmlFont(css).replace(/\s+/g, ' ').trim();
    expect(out).toBe('.keep { color: red; } @supports (x) { .pad { padding-left: 0.05em; } }');
  });

  /** Штрих производной без шрифта Temml правится стилем, только в Chromium. */
  it('штрих — правкой стиля для Chromium', () => {
    expect(mathStyles()).toMatch(/@supports \(not \(-moz-appearance: none\)\) \{\s*mo\.tml-prime \{/);
  });
});

describe('экспорт в HTML', () => {
  it('стиль формул — только если формула есть', () => {
    const tokens = { 'color-fg-default': '#1f2328' };
    expect(exportPage('<p>текст</p>', 'план', tokens)).not.toContain('tml-prime');
    expect(exportPage('<p><span class="zn-math"><math><mi>x</mi></math></span></p>', 'план', tokens)).toContain(
      'tml-prime',
    );
  });

  /** Шрифтов в файле нет — и политика их не пускает. */
  it('политика файла — стиль и картинки, ничего больше', () => {
    const page = exportPage('<p><span class="zn-math"><math><mi>x</mi></math></span></p>', 'план', {});
    expect(page).toContain(`content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"`);
    expect(page).not.toContain('font-src');
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
