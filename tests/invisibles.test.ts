import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { breakPositions } from '../src/editor/invisibles';

/**
 * Пробелы и табы рисует CodeMirror, знак переноса — наш. Проверяется поэтому
 * только он: где стоит и, главное, где не стоит.
 */

function state(doc: string): EditorState {
  return EditorState.create({ doc });
}

/** Весь документ одним диапазоном — как если бы он целиком был на экране. */
function whole(doc: string): number[] {
  const s = state(doc);
  return breakPositions(s, [{ from: 0, to: s.doc.length }]);
}

describe('знаки переноса строк', () => {
  it('стоят в конце каждой строки, кроме последней', () => {
    const doc = 'раз\nдва\nтри';
    // Конец первой строки — 3, второй — 7. После «три» переноса нет.
    expect(whole(doc)).toEqual([3, 7]);
  });

  /**
   * Файл, оканчивающийся переносом, — обычное дело, и последняя строка в нём
   * пустая. Знак ей не положен: после неё переноса уже нет.
   */
  it('не выходят за последнюю строку у файла с переносом на конце', () => {
    expect(whole('раз\n')).toEqual([3]);
  });

  it('в файле из одной строки их нет вовсе', () => {
    expect(whole('одна строка')).toEqual([]);
    expect(whole('')).toEqual([]);
  });

  it('пустая строка знак получает — в ней перенос и есть всё содержимое', () => {
    expect(whole('раз\n\nтри')).toEqual([3, 4]);
  });

  /**
   * Обходятся только видимые строки: файл бывает в миллион строк, а на экране
   * их всегда полсотни. Инвариант 6 не делает исключения для оформления.
   */
  it('считаются только в переданных диапазонах', () => {
    const doc = ['раз', 'два', 'три', 'четыре'].join('\n');
    const s = state(doc);
    const second = s.doc.line(2);

    expect(breakPositions(s, [{ from: second.from, to: second.to }])).toEqual([second.to]);
  });
});
