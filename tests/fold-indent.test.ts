import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';

import { LanguageSupport, StreamLanguage } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

import { indentFold, indentFolding, indentOf } from '../src/editor/fold-indent';

/**
 * Свёртка по отступам (задача 92).
 *
 * Правило здесь своё, а не из разбора, и потому проверяется построчно.
 * Главное, что легко нарушить: пустая строка не кончает блок, но и не входит
 * в него, а таб считается колонками, а не знаками.
 */

function doc(...lines: string[]): Text {
  return Text.of(lines);
}

/** Какие строки попадут в свёртку, начатую на этой. */
function foldedLines(text: Text, at: number, tabSize = 4): string | null {
  const range = indentFold(text, at, tabSize);
  if (range === null) return null;
  return text.sliceString(range.from, range.to);
}

describe('отступ строки', () => {
  it('считается в колонках, а не в знаках', () => {
    expect(indentOf('без отступа', 4)).toBe(0);
    expect(indentOf('  два пробела', 4)).toBe(2);
    // Таб — это колонка шириной в четыре: строка с табом глубже строки
    // с двумя пробелами, хотя знаков в отступе у неё меньше.
    expect(indentOf('\tтаб', 4)).toBe(4);
    expect(indentOf('\tтаб', 2)).toBe(2);
  });

  it('у пустой строки отступа нет', () => {
    expect(indentOf('', 4)).toBeNull();
    expect(indentOf('   ', 4)).toBeNull();
    expect(indentOf('\t\t', 4)).toBeNull();
  });
});

describe('свёртка по отступам', () => {
  it('сворачивает то, что написано глубже', () => {
    const text = doc('корень:', '  первый: 1', '  второй: 2', 'другой: 3');

    expect(foldedLines(text, 1)).toBe('\n  первый: 1\n  второй: 2');
  });

  it('строка без вложенного не сворачивается', () => {
    const text = doc('первый: 1', 'второй: 2');

    expect(indentFold(text, 1, 4)).toBeNull();
    expect(indentFold(text, 2, 4)).toBeNull();
  });

  /**
   * Пустая строка блок не кончает: между пунктами раздела бывает пустота,
   * и обрывать на ней значило бы сворачивать по одному пункту.
   */
  it('пустая строка не кончает блок', () => {
    const text = doc('раздел:', '  первый', '', '  второй', 'следующий:');

    expect(foldedLines(text, 1)).toBe('\n  первый\n\n  второй');
  });

  /** Но и в блок не входит: хвост из пустых строк остаётся снаружи. */
  it('пустой хвост в блок не входит', () => {
    const text = doc('раздел:', '  первый', '', '', 'следующий:');

    expect(foldedLines(text, 1)).toBe('\n  первый');
  });

  it('вложенность считается на любую глубину', () => {
    const text = doc('а:', '  б:', '    в: 1', '  г: 2', 'д:');

    expect(foldedLines(text, 1)).toBe('\n  б:\n    в: 1\n  г: 2');
    expect(foldedLines(text, 2)).toBe('\n    в: 1');
  });

  it('пустая строка сама не сворачивается', () => {
    const text = doc('', '  что-то');

    expect(indentFold(text, 1, 4)).toBeNull();
  });

  /** Блок до конца файла — обычное дело у последнего раздела. */
  it('доходит до конца файла', () => {
    const text = doc('раздел:', '  первый', '  второй');

    expect(foldedLines(text, 1)).toBe('\n  первый\n  второй');
  });

  /**
   * Таб глубже двух пробелов при ширине четыре — и мельче при ширине два.
   * Ради этого отступ и считается колонками.
   */
  it('слушается ширины таба', () => {
    const text = doc('  два пробела', '\tтаб');

    expect(foldedLines(text, 1, 4)).toBe('\n\tтаб');
    expect(indentFold(text, 1, 2)).toBeNull();
  });
});

describe('кому ставится правило', () => {
  /**
   * Главная граница задачи. `foldService` спрашивается раньше дерева:
   * поставь мы правило языку с разбором — грубая свёртка по отступам молча
   * заменила бы собой свёртку по блокам, которую сделала задача 33.
   */
  it('языку с разбором не ставится', () => {
    const support = markdown({ base: markdownLanguage });

    expect(indentFolding(support)).toEqual([]);
  });

  it('построчному языку ставится', () => {
    const stream = new LanguageSupport(
      StreamLanguage.define({ token: (stream) => (stream.next(), null) }),
    );

    expect(indentFolding(stream)).not.toEqual([]);
  });

  it('файлу без языка ставится', () => {
    expect(indentFolding(null)).not.toEqual([]);
  });
});
