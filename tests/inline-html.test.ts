import { describe, expect, it } from 'vitest';

import { pairTags, readTag, type PlacedTag } from '../src/editor/inline-html';

/**
 * Строчный HTML (задача 107): какие теги наши и как они встают в пары.
 *
 * Правило одно на превью и на вывод HTML (задача 108), поэтому граница
 * «наш тег / исходник» закреплена здесь, а не в тестах превью.
 */
describe('белый список тегов', () => {
  it('узнаёт парные теги без атрибутов', () => {
    expect(readTag('<u>')).toEqual({ name: 'u', closing: false });
    expect(readTag('</u>')).toEqual({ name: 'u', closing: true });
    expect(readTag('<kbd>')).toEqual({ name: 'kbd', closing: false });
    expect(readTag('</sup>')).toEqual({ name: 'sup', closing: true });
  });

  it('не различает регистр и терпит пробел перед скобкой', () => {
    expect(readTag('<U>')).toEqual({ name: 'u', closing: false });
    expect(readTag('<mark >')).toEqual({ name: 'mark', closing: false });
  });

  /**
   * Атрибут — это стиль, класс или обработчик события: превью их
   * не исполняет, значит и тег с ними остаётся исходником.
   */
  it('тег с атрибутом остаётся исходником', () => {
    expect(readTag('<u class="x">')).toBeNull();
    expect(readTag('<u onclick="alert(1)">')).toBeNull();
  });

  it('незнакомые, одиночные и испорченные — исходник', () => {
    expect(readTag('<script>')).toBeNull();
    expect(readTag('<span>')).toBeNull();
    // `<br>` не парный — его возьмёт только вывод HTML.
    expect(readTag('<br>')).toBeNull();
    expect(readTag('<u/>')).toBeNull();
    expect(readTag('< u>')).toBeNull();
  });
});

describe('пары тегов', () => {
  /** Теги подряд на своих местах: смещение — порядковый номер. */
  function placed(...texts: string[]): PlacedTag[] {
    return texts.map((text, at) => ({ from: at * 10, to: at * 10 + 3, tag: readTag(text)! }));
  }

  it('открывающий и закрывающий становятся парой', () => {
    const pairs = pairTags(placed('<u>', '</u>'));
    expect(pairs).toEqual([{ name: 'u', open: { from: 0, to: 3 }, close: { from: 10, to: 13 } }]);
  });

  it('вложенные пары разбираются изнутри наружу', () => {
    const pairs = pairTags(placed('<u>', '<kbd>', '</kbd>', '</u>'));
    expect(pairs.map((pair) => pair.name)).toEqual(['kbd', 'u']);
  });

  /** Показывать оформление без пары — угадывать, где оно кончается. */
  it('тег без пары остаётся исходником', () => {
    expect(pairTags(placed('<u>'))).toEqual([]);
    expect(pairTags(placed('</u>'))).toEqual([]);
    expect(pairTags(placed('</u>', '<u>'))).toEqual([]);
  });

  /**
   * Закрывающий ищет ближайший открытый своего имени; то, что открыто
   * после него и не закрыто, пары не получает.
   */
  it('перекрёст закрывает внешнюю пару, внутренняя остаётся без пары', () => {
    const pairs = pairTags(placed('<u>', '<sup>', '</u>', '</sup>'));
    expect(pairs).toEqual([{ name: 'u', open: { from: 0, to: 3 }, close: { from: 20, to: 23 } }]);
  });
});
