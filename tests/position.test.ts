import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { positionOf, positionLabel } from '../src/ui/position';

/**
 * Позиция курсора — чистая функция над состоянием редактора, и проверяется
 * без окна: живое приложение к ответу ничего не добавляет.
 *
 * Проверяется в основном арифметика границ. Ошибка на единицу здесь заметна
 * не сразу и раздражает долго: редакторы считают строки и столбцы с единицы,
 * а CodeMirror — позиции с нуля.
 */

const DOC = 'первая\nвторая строка\n\nчетвёртая\n';

function at(anchor: number, head = anchor): EditorState {
  return EditorState.create({
    doc: DOC,
    selection: { anchor, head },
  });
}

describe('позиция курсора', () => {
  it('начало документа — строка 1, столбец 1', () => {
    const position = positionOf(at(0));
    expect(position.line).toBe(1);
    expect(position.column).toBe(1);
    expect(position.selected).toBe(0);
    expect(position.selectedLines).toBe(null);
  });

  it('конец строки — столбец на единицу больше её длины', () => {
    // «первая» — шесть букв, курсор за последней.
    const position = positionOf(at(6));
    expect(position.line).toBe(1);
    expect(position.column).toBe(7);
  });

  it('после перевода строки начинается следующая строка', () => {
    const position = positionOf(at(7));
    expect(position.line).toBe(2);
    expect(position.column).toBe(1);
  });

  it('пустая строка — столбец 1, а не 0', () => {
    // Третья строка пуста: 'первая\n' + 'вторая строка\n' = 21.
    const position = positionOf(at(21));
    expect(position.line).toBe(3);
    expect(position.column).toBe(1);
  });

  it('пустой документ не падает', () => {
    const position = positionOf(EditorState.create({ doc: '' }));
    expect(position.line).toBe(1);
    expect(position.column).toBe(1);
  });
});

describe('выделение', () => {
  it('считается в символах', () => {
    const position = positionOf(at(0, 6));
    expect(position.selected).toBe(6);
    expect(position.selectedLines).toBe(1);
  });

  it('считается и когда протянуто снизу вверх', () => {
    const position = positionOf(at(6, 0));
    expect(position.selected).toBe(6);
    // Курсор — там, где head, то есть в начале.
    expect(position.column).toBe(1);
  });

  it('через перевод строки захватывает две строки', () => {
    const position = positionOf(at(0, 10));
    expect(position.selectedLines).toBe(2);
  });

  it('суммируется по всем курсорам, но строки при этом не считаются', () => {
    // Несколько диапазонов задаются только через EditorSelection.create:
    // литерал {anchor, head} — это ровно один диапазон, и остальные молча
    // потерялись бы.
    const state = EditorState.create({
      doc: DOC,
      selection: EditorSelection.create(
        [EditorSelection.range(0, 3), EditorSelection.range(7, 10)],
        1,
      ),
      extensions: EditorState.allowMultipleSelections.of(true),
    });

    const position = positionOf(state);
    expect(position.selected).toBe(6);
    expect(position.selectedLines).toBe(null);
  });
});

describe('подпись', () => {
  it('без выделения — только строка и столбец', () => {
    expect(positionLabel(positionOf(at(0)))).toBe('стр 1, кол 1');
  });

  it('с выделением внутри строки — без числа строк', () => {
    expect(positionLabel(positionOf(at(0, 6)))).toBe('стр 1, кол 7 · выделено 6');
  });

  it('с выделением через строки — с числом строк', () => {
    expect(positionLabel(positionOf(at(0, 10)))).toBe(
      'стр 2, кол 4 · выделено 10 в 2 строках',
    );
  });

  /** Одиннадцать ведёт себя не как один — ради этого и заведён plural. */
  it('склоняет число строк', () => {
    const say = (lines: number) =>
      positionLabel({ line: 1, column: 1, selected: 99, selectedLines: lines });

    expect(say(2)).toContain('в 2 строках');
    expect(say(5)).toContain('в 5 строках');
    expect(say(11)).toContain('в 11 строках');
    expect(say(21)).toContain('в 21 строке');
  });
});
