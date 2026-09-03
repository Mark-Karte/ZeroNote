import { describe, expect, it } from 'vitest';
import {
  columnAt,
  detectIndent,
  indentUnitOf,
  resolveIndent,
  tabInsertion,
  type Indent,
} from '../src/editor/indent';

/**
 * Отступ определяется по файлу, а настройка — только умолчание (Р-106).
 *
 * Проверять это надо числами: ошибка здесь не падает и не подсвечивается,
 * а тихо смешивает табы с пробелами в чужом файле — то есть нарушает
 * инвариант 1 первым же нажатием `Tab`.
 */

const SETTINGS = { style: 'spaces', width: 4 } as const;

describe('определение отступа по содержимому', () => {
  it('видит табы', () => {
    const code = ['function f() {', '\treturn 1;', '}'].join('\n');
    expect(detectIndent(code)).toEqual({ style: 'tabs' });
  });

  it('видит пробелы и считает, сколько их', () => {
    const code = ['def f():', '    return 1', ''].join('\n');
    expect(detectIndent(code)).toEqual({ style: 'spaces', width: 4 });
  });

  it('различает два пробела и четыре', () => {
    const two = ['a:', '  b:', '    c'].join('\n');
    const four = ['a:', '    b:', '        c'].join('\n');

    expect(detectIndent(two)).toEqual({ style: 'spaces', width: 2 });
    expect(detectIndent(four)).toEqual({ style: 'spaces', width: 4 });
  });

  /**
   * Выровненные строки продолжения — обычное дело в C и в JSDoc, и они дают
   * шаг в один пробел. Побеждать должен не редкий шаг, а частый.
   */
  it('не сбивается на строке, выровненной пробелом', () => {
    const code = [
      '/*',
      ' * комментарий',
      ' */',
      'int main() {',
      '    int a = 1;',
      '    if (a) {',
      '        return a;',
      '    }',
      '}',
    ].join('\n');

    expect(detectIndent(code)).toEqual({ style: 'spaces', width: 4 });
  });

  it('в файле без отступов не гадает', () => {
    expect(detectIndent('одна строка\nи вторая\n')).toBeNull();
    expect(detectIndent('')).toBeNull();
  });

  /** Пустые строки — не отступ, даже если в них случайно остались пробелы. */
  it('не считает отступом пустую строку с пробелами', () => {
    const code = ['a', '   ', 'b'].join('\n');
    expect(detectIndent(code)).toBeNull();
  });

  it('при смешении выбирает то, чего больше', () => {
    const mostlyTabs = ['\ta', '\tb', '\tc', '  d'].join('\n');
    expect(detectIndent(mostlyTabs)).toEqual({ style: 'tabs' });
  });
});

describe('отступ файла и настройка', () => {
  it('файл главнее настройки', () => {
    const tabbed = 'a\n\tb\n';
    expect(resolveIndent(tabbed, SETTINGS)).toEqual({
      style: 'tabs',
      width: 4,
      source: 'detected',
    });
  });

  /** Ширину таба по файлу не узнать: таб — один знак, а не «сколько-то». */
  it('ширину таба берёт из настройки', () => {
    expect(resolveIndent('a\n\tb\n', { style: 'tabs', width: 8 }).width).toBe(8);
  });

  it('без отступов в файле берёт настройку целиком', () => {
    expect(resolveIndent('просто текст\n', SETTINGS)).toEqual({
      style: 'spaces',
      width: 4,
      source: 'settings',
    });
  });
});

describe('что вставляет Tab', () => {
  const spaces: Indent = { style: 'spaces', width: 4, source: 'settings' };
  const tabs: Indent = { style: 'tabs', width: 4, source: 'settings' };

  it('в режиме табов — таб', () => {
    expect(indentUnitOf(tabs)).toBe('\t');
    expect(tabInsertion(tabs, 3)).toBe('\t');
  });

  /**
   * В режиме пробелов — до ближайшей позиции табуляции, а не всегда четыре.
   * Иначе набор в середине строки уводил бы текст в случайные столбцы.
   */
  it('в режиме пробелов — до ближайшей позиции табуляции', () => {
    expect(tabInsertion(spaces, 0)).toBe('    ');
    expect(tabInsertion(spaces, 1)).toBe('   ');
    expect(tabInsertion(spaces, 3)).toBe(' ');
    expect(tabInsertion(spaces, 4)).toBe('    ');
  });

  it('единица отступа — то, чем набирается один уровень', () => {
    expect(indentUnitOf(spaces)).toBe('    ');
  });
});

describe('столбец с учётом табуляции', () => {
  it('таб доводит до следующей позиции табуляции', () => {
    expect(columnAt('', 4)).toBe(0);
    expect(columnAt('ab', 4)).toBe(2);
    expect(columnAt('\t', 4)).toBe(4);
    expect(columnAt('a\t', 4)).toBe(4);
    expect(columnAt('abcd\t', 4)).toBe(8);
    expect(columnAt('\t\t', 4)).toBe(8);
  });
});
