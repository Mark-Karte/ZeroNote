import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type SelectionRange } from '@codemirror/state';

import { activeLineDecorations } from '../src/editor/active-line';

/**
 * Подсветка строки курсора (задача 100).
 *
 * Проверяется одно правило и его край: подсвечивается строка **пустого**
 * курсора. Пока выделение не пусто, подсветки нет — иначе сплошная
 * подложка закрыла бы собой выделение, ради которого всё и затевалось.
 */

const DOC = ['раз', 'два', 'три', 'четыре'].join('\n');

/** Номера строк, которые получили украшение. */
function highlighted(state: EditorState): number[] {
  const lines: number[] = [];
  activeLineDecorations(state).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number);
  });
  return lines;
}

function stateWith(selection: EditorSelection | SelectionRange): EditorState {
  // Без разрешения на несколько выделений состояние оставляет от них одно
  // главное — как и в приложении, где это разрешение стоит в наборе.
  return EditorState.create({
    doc: DOC,
    selection,
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
}

function at(line: number, column = 0): number {
  return EditorState.create({ doc: DOC }).doc.line(line).from + column;
}

describe('подсветка строки курсора', () => {
  it('подсвечивает строку, на которой стоит курсор', () => {
    const state = stateWith(EditorSelection.cursor(at(2)));
    expect(highlighted(state)).toEqual([2]);
  });

  it('гаснет, пока выделение не пусто', () => {
    const state = stateWith(EditorSelection.range(at(2), at(2, 3)));
    expect(highlighted(state)).toEqual([]);
  });

  it('гаснет и при выделении через несколько строк', () => {
    const state = stateWith(EditorSelection.range(at(1), at(3, 2)));
    expect(highlighted(state)).toEqual([]);
  });

  it('при нескольких курсорах подсвечивает строки только пустых', () => {
    const state = stateWith(
      EditorSelection.create(
        [
          EditorSelection.cursor(at(1)),
          EditorSelection.range(at(2), at(2, 3)),
          EditorSelection.cursor(at(4)),
        ],
        0,
      ),
    );
    expect(highlighted(state)).toEqual([1, 4]);
  });

  it('два курсора на одной строке дают одно украшение', () => {
    const state = stateWith(
      EditorSelection.create(
        [EditorSelection.cursor(at(3)), EditorSelection.cursor(at(3, 2))],
        0,
      ),
    );
    expect(highlighted(state)).toEqual([3]);
  });
});
