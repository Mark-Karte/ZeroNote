import { describe, expect, it } from 'vitest';

import { lookupFor } from '../src/editor/callouts';
import { isDiagram, type Drawn } from '../src/editor/diagram';
import { markdownToHtml, type ConvertContext } from '../src/html/convert';
import { diagramSize } from '../src/export/copy';

/**
 * Схемы наружу (задача 118): печать, PDF, экспорт в HTML и копирование
 * получают SVG того же mermaid, что у превью, в цветах бумаги.
 *
 * Сам mermaid без окна не рисует — рисование подменено: здесь проверяется,
 * какие блоки уходят в mermaid, с каким текстом, и что выходит, когда
 * схема не нарисовалась. Настоящая схема на бумаге, в файле и в Word
 * проверена на живом окне.
 */

const SVG = '<svg viewBox="0 0 120 40"><text>схема</text></svg>';

/** Контекст, где рисование схемы записывается и отвечает `answer`. */
function context(answer: (source: string) => Drawn = () => ({ svg: SVG })): {
  context: ConvertContext;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    context: {
      callouts: lookupFor([{ id: 'note', title: 'Заметка', icon: 'md.callout-note', color: 'accent' }]),
      sourcePath: null,
      loadImage: async () => '',
      loadEmbed: async () => '',
      drawDiagram: async (source) => {
        asked.push(source);
        return answer(source);
      },
    },
  };
}

const FLOW = '```mermaid\nflowchart LR\n    A --> B\n```';

describe('какие блоки — схемы', () => {
  it('язык блока — первым словом, без оглядки на регистр', () => {
    expect(isDiagram('mermaid')).toBe(true);
    expect(isDiagram('Mermaid')).toBe(true);
    expect(isDiagram('  mermaid  title="план"')).toBe(true);
    expect(isDiagram('mermaidjs')).toBe(false);
    expect(isDiagram('js')).toBe(false);
    expect(isDiagram(null)).toBe(false);
  });
});

describe('вывод HTML', () => {
  it('блок mermaid — схемой, в mermaid уходит тело блока', async () => {
    const { context: ctx, asked } = context();
    const out = await markdownToHtml(`до\n\n${FLOW}\n\nпосле\n`, ctx);
    expect(out.html).toBe(`<p>до</p>\n<div class="zn-diagram">${SVG}</div>\n<p>после</p>`);
    expect(asked).toEqual(['flowchart LR\n    A --> B']);
    expect(out.problems).toEqual([]);
  });

  /** mermaid — самая крупная зависимость: без схем его не зовут вовсе. */
  it('заметка без схем mermaid не зовёт', async () => {
    const { context: ctx, asked } = context();
    const out = await markdownToHtml('```js\nconst a = 1;\n```\n\n    отступом\n', ctx);
    expect(asked).toEqual([]);
    expect(out.html).not.toContain('zn-diagram');
  });

  /** Пустой блок и превью не рисует. */
  it('пустой блок — кодом, mermaid не зовётся', async () => {
    const { context: ctx, asked } = context();
    const out = await markdownToHtml('```mermaid\n```\n', ctx);
    expect(asked).toEqual([]);
    expect(out.html).toContain('<pre');
  });

  it('в коллауте — схемой, без знаков цитаты в тексте схемы', async () => {
    const { context: ctx, asked } = context();
    const out = await markdownToHtml('> [!note]\n> ```mermaid\n> flowchart LR\n>     A --> B\n> ```\n', ctx);
    expect(asked).toEqual(['flowchart LR\n    A --> B']);
    expect(out.html).toContain(`<div class="zn-diagram">${SVG}</div>`);
  });

  /**
   * На экране блок в пункте списка остаётся исходником: замена строк
   * съела бы знак пункта. У бумаги такого ограничения нет.
   */
  it('в пункте списка — схемой', async () => {
    const { context: ctx } = context();
    const out = await markdownToHtml(`- пункт\n\n  ${FLOW.split('\n').join('\n  ')}\n`, ctx);
    expect(out.html).toContain(`<div class="zn-diagram">${SVG}</div>`);
  });

  it('не нарисовалась — кодом, и причина первой строкой в полосе', async () => {
    const { context: ctx } = context(() => ({
      error: 'Схема не разобрана: Parse error on line 2:\n...A --\n-----^',
    }));
    const out = await markdownToHtml(`# План\n\n${FLOW}\n`, ctx);
    expect(out.html).not.toContain('zn-diagram');
    expect(out.html).toContain('flowchart LR');
    expect(out.problems).toEqual([
      'блок mermaid на строке 3 вышел кодом — схема не разобрана: Parse error on line 2',
    ]);
  });

  it('две схемы — по разу каждая, по порядку', async () => {
    const { context: ctx, asked } = context((source) => ({ svg: `<svg>${source.length}</svg>` }));
    const second = '```mermaid\nsequenceDiagram\n    A->>B: привет\n```';
    const out = await markdownToHtml(`${FLOW}\n\n${second}\n`, ctx);
    expect(asked).toEqual(['flowchart LR\n    A --> B', 'sequenceDiagram\n    A->>B: привет']);
    expect(out.html.match(/zn-diagram/g)).toHaveLength(2);
  });
});

describe('картинка для Word', () => {
  /** Ширину mermaid пишет как `100%`: размер картинки — из `viewBox`. */
  it('размер — из viewBox', () => {
    expect(diagramSize('-8 -8 184.5 70')).toEqual({ width: 184.5, height: 70 });
    expect(diagramSize('0,0,120,40')).toEqual({ width: 120, height: 40 });
  });

  it('без размера — нет картинки', () => {
    expect(diagramSize(null)).toBeNull();
    expect(diagramSize('0 0 100')).toBeNull();
    expect(diagramSize('0 0 0 40')).toBeNull();
    expect(diagramSize('0 0 ширина 40')).toBeNull();
  });
});
