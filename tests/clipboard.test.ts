import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { copiedText, pasteSpec } from '../src/editor/clipboard';

/**
 * Пункт меню и клавиша называются одинаково и обязаны делать одно и то же.
 * Клавиши обслуживает вебвью (Р-108), пункты — этот код, и разойтись они
 * не должны: расхождение здесь выглядит как «иногда вставляет не туда».
 */

function stateWith(doc: string, ranges: [number, number][] = [[0, 0]]): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.create(
      ranges.map(([from, to]) => EditorSelection.range(from, to)),
      ranges.length - 1,
    ),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
}

/** Что останется в документе, если применить правку. */
function applied(state: EditorState, spec: TransactionSpec): string {
  return state.update(spec).state.doc.toString();
}

describe('что попадает в буфер обмена', () => {
  it('выделенное — как есть', () => {
    const state = stateWith('одна\nдве\nтри', [[5, 8]]);
    const copied = copiedText(state);

    expect(copied.text).toBe('две');
    expect(copied.linewise).toBe(false);
    expect(applied(state, copied.cut)).toBe('одна\n\nтри');
  });

  /**
   * Пустое выделение означает «вся строка» — так ведёт себя и CodeMirror,
   * и Notepad++. Без этого `Ctrl+C` без выделения был бы бесполезен.
   */
  it('целую строку, когда выделения нет', () => {
    const state = stateWith('одна\nдве\nтри', [[6, 6]]);
    const copied = copiedText(state);

    expect(copied.text).toBe('две');
    expect(copied.linewise).toBe(true);
    // Вместе с переносом: вырезанная строка не оставляет за собой пустую.
    expect(applied(state, copied.cut)).toBe('одна\nтри');
  });

  it('строку один раз, сколько бы курсоров на ней ни стояло', () => {
    const state = stateWith('одна\nдве\nтри', [
      [5, 5],
      [7, 7],
    ]);
    const copied = copiedText(state);

    expect(copied.text).toBe('две');
    expect(applied(state, copied.cut)).toBe('одна\nтри');
  });

  it('несколько выделений — через перенос строки', () => {
    const state = stateWith('одна\nдве\nтри', [
      [0, 4],
      [9, 12],
    ]);
    expect(copiedText(state).text).toBe('одна\nтри');
  });

  /** Последняя строка переноса за собой не имеет: за конец документа не выходим. */
  it('не выходит за конец документа на последней строке', () => {
    const state = stateWith('одна\nдве', [[7, 7]]);
    const copied = copiedText(state);

    expect(copied.text).toBe('две');
    expect(applied(state, copied.cut)).toBe('одна\n');
  });
});

describe('вставка', () => {
  it('заменяет выделение', () => {
    const state = stateWith('одна\nдве', [[0, 4]]);
    expect(applied(state, pasteSpec(state, 'ноль', false))).toBe('ноль\nдве');
  });

  /**
   * Строку, скопированную целиком, вставляют перед текущей строкой,
   * а не в середину слова, на котором стоит курсор.
   */
  it('строку, скопированную целиком, ставит перед строкой курсора', () => {
    const state = stateWith('одна\nдве', [[6, 6]]);
    expect(applied(state, pasteSpec(state, 'ноль', true))).toBe('одна\nноль\nдве');
  });

  it('в середину слова — если строку целиком не копировали', () => {
    const state = stateWith('одна\nдве', [[6, 6]]);
    expect(applied(state, pasteSpec(state, 'ноль', false))).toBe('одна\nднольве');
  });

  /** Ради этого мультикурсор и заводят: строк столько же, сколько курсоров. */
  it('раздаёт строки по курсорам, когда их поровну', () => {
    const state = stateWith('a\nb', [
      [0, 0],
      [2, 2],
    ]);
    expect(applied(state, pasteSpec(state, 'x\ny', false))).toBe('xa\nyb');
  });

  it('вставляет целиком, когда строк и курсоров разное число', () => {
    const state = stateWith('a\nb', [
      [0, 0],
      [2, 2],
    ]);
    expect(applied(state, pasteSpec(state, 'x\ny\nz', false))).toBe('x\ny\nza\nx\ny\nzb');
  });

  it('не вставляет строку дважды, когда курсоры стоят на одной строке', () => {
    const state = stateWith('одна\nдве', [
      [5, 5],
      [7, 7],
    ]);
    expect(applied(state, pasteSpec(state, 'ноль', true))).toBe('одна\nноль\nдве');
  });
});
