import { describe, expect, it } from 'vitest';
import { parse, matchRange, matches, withMode } from '../src/ui/palette/query';

describe('разбор строки палитры', () => {
  it('без префикса ищет файлы', () => {
    expect(parse('идея')).toEqual({ mode: 'files', term: 'идея' });
  });

  it('> переключает на команды', () => {
    expect(parse('>сохр')).toEqual({ mode: 'commands', term: 'сохр' });
  });

  it('# переключает на теги', () => {
    expect(parse('#работа')).toEqual({ mode: 'tags', term: 'работа' });
  });

  it('один префикс без запроса — это режим с пустым запросом', () => {
    // Важный случай: набрав «>», пользователь должен сразу увидеть
    // весь список команд, а не пустоту.
    expect(parse('>')).toEqual({ mode: 'commands', term: '' });
    expect(parse('#')).toEqual({ mode: 'tags', term: '' });
  });

  it('пробел после префикса не попадает в запрос', () => {
    expect(parse('> сохранить')).toEqual({ mode: 'commands', term: 'сохранить' });
  });

  it('пробел перед префиксом режим не отменяет', () => {
    // Набирая быстро, легко задеть пробел первым.
    expect(parse('  >сохр')).toEqual({ mode: 'commands', term: 'сохр' });
  });

  it('пустая строка — режим файлов', () => {
    expect(parse('')).toEqual({ mode: 'files', term: '' });
  });

  it('префикс внутри строки режима не меняет', () => {
    // «C#» — часть имени файла, а не переключатель.
    expect(parse('заметка о C#')).toEqual({ mode: 'files', term: 'заметка о C#' });
  });
});

describe('совпадение по вхождению', () => {
  it('находит кусок и его место', () => {
    expect(matchRange('Сохранить как', 'как')).toEqual([10, 3]);
  });

  it('регистр не мешает', () => {
    expect(matchRange('Сохранить', 'СОХР')).toEqual([0, 4]);
    expect(matchRange('Сохранить', 'сохр')).toEqual([0, 4]);
  });

  it('нет совпадения — null, а не пустой диапазон', () => {
    expect(matchRange('Сохранить', 'печать')).toBeNull();
  });

  it('пустой запрос ничего не подсвечивает, но подходит всему', () => {
    expect(matchRange('Сохранить', '')).toBeNull();
    expect(matches('Сохранить', '')).toBe(true);
    expect(matches('Сохранить', 'печать')).toBe(false);
  });
});

describe('переключение режима', () => {
  it('меняет префикс и сохраняет набранное', () => {
    expect(withMode('сохр', 'commands')).toBe('>сохр');
    expect(withMode('>сохр', 'tags')).toBe('#сохр');
    expect(withMode('#работа', 'files')).toBe('работа');
  });

  it('на пустой строке даёт только знак режима', () => {
    expect(withMode('', 'commands')).toBe('>');
    expect(withMode('', 'files')).toBe('');
  });

  it('повторное переключение в тот же режим ничего не портит', () => {
    // Ctrl+Shift+P при уже открытых командах не должен дать «>>сохр».
    expect(withMode('>сохр', 'commands')).toBe('>сохр');
  });
});
