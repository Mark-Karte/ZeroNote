import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { WidgetType } from '@codemirror/view';

/**
 * Формула в ячейке таблицы, когда Temml приезжает позже (Р4 ревизии).
 *
 * Заметка с таблицей открыта раньше, чем Temml загрузился: сетка собирается
 * с формулой исходником. Раньше так и оставалось, пока таблицу не поправят:
 * модель лежала в кэше по исходнику, а приезд Temml поле блочного превью
 * не будил. Модули грузятся заново — в общем прогоне Temml уже загружен
 * соседними тестами, и этот путь был бы не виден.
 */
async function fresh() {
  vi.resetModules();
  const tables = await import('../src/editor/tables');
  const math = await import('../src/editor/math');
  const block = await import('../src/editor/block-preview');
  const language = await import('../src/editor/markdown-language');
  return { tables, math, block, language };
}

const DOC = 'текст\n\n| a | b |\n|---|---|\n| $x^2$ | 2 |\n\nконец';

function tableNode(state: EditorState): SyntaxNode {
  let found: SyntaxNode | null = null;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'Table') found = node.node;
    },
  });
  if (!found) throw new Error('таблица не разобралась');
  return found;
}

describe('формула в ячейке после загрузки Temml', () => {
  it('кэш таблиц отдаёт модель с формулами, как только Temml приехал', async () => {
    const { tables, math, language } = await fresh();
    const state = EditorState.create({ doc: DOC, extensions: language.markdownSupport() });
    ensureSyntaxTree(state, DOC.length, 5000);

    expect(math.mathReady()).toBe(false);
    expect(tables.tableAt(state, tableNode(state))?.math).toBe(false);

    await math.loadMath();

    const model = tables.tableAt(state, tableNode(state));
    expect(model?.math).toBe(true);
    expect(model?.rows[0]?.[0]?.html).toContain('<math');
  });

  it('поле блочного превью пересобирает сетку по приезду Temml', async () => {
    const { math, block, language } = await fresh();
    const field = block.blockField();
    const start = EditorState.create({ doc: DOC, extensions: [language.markdownSupport(), field] });
    ensureSyntaxTree(start, DOC.length, 5000);
    // Разбор приехал — поле пересобралось уже с деревом.
    const parsed = start.update({}).state;

    const tableMath = (state: EditorState): boolean | undefined => {
      let found: boolean | undefined;
      const iter = state.field(field).shapes.blocks.iter();
      for (; iter.value !== null; iter.next()) {
        const widget = iter.value.spec.widget as (WidgetType & { model?: { math: boolean } }) | undefined;
        if (widget?.model) found = widget.model.math;
      }
      return found;
    };

    expect(tableMath(parsed)).toBe(false);
    await math.loadMath();
    const after = parsed.update({ effects: math.mathArrived.of(null) }).state;
    expect(tableMath(after)).toBe(true);
  });
});
