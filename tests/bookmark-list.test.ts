import { describe, expect, it } from 'vitest';
import {
  bookmarkCount,
  bookmarkGroups,
  type BookmarkSource,
} from '../src/editor/bookmark-list';

/**
 * Список закладок для панели (задача 59, Р-157).
 *
 * Проверяется сборка, а не вид: что попадает в список, в каком порядке
 * и что из него выпадает. Вид — вопрос к снимку живого окна.
 */

function source(over: Partial<BookmarkSource> = {}): BookmarkSource {
  const text = ['первая строка', '  строка с отступом', '', 'четвёртая'];
  return {
    id: 1,
    title: 'Заметка.md',
    lines: [1],
    lineCount: text.length,
    lineText: (line: number) => text[line - 1] ?? '',
    ...over,
  };
}

describe('список закладок', () => {
  it('собирается по вкладкам', () => {
    const groups = bookmarkGroups([source({ lines: [1, 4] })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('Заметка.md');
    expect(groups[0]!.rows.map((row) => row.line)).toEqual([1, 4]);
  });

  /** Отступ в списке не нужен: он говорит про код, а не про место. */
  it('снимает отступ строки', () => {
    const groups = bookmarkGroups([source({ lines: [2] })]);
    expect(groups[0]!.rows[0]!.text).toBe('строка с отступом');
  });

  /**
   * Закладка на пустой строке — не ошибка: так помечают место, куда вернутся
   * писать. В список она идёт, а показать её пустой подписью — дело панели.
   */
  it('пустую строку не выбрасывает', () => {
    const groups = bookmarkGroups([source({ lines: [3] })]);
    expect(groups[0]!.rows).toHaveLength(1);
    expect(groups[0]!.rows[0]!.text).toBe('');
  });

  /**
   * Номера приходят из сессии, а её правят руками. Строка за концом файла
   * в список не идёт: придумывать строку, которой нет, незачем — то же
   * правило, что при восстановлении закладок в задаче 37.
   */
  it('отбрасывает номера за концом файла', () => {
    const groups = bookmarkGroups([source({ lines: [0, 2, 99] })]);
    expect(groups[0]!.rows.map((row) => row.line)).toEqual([2]);
  });

  it('упорядочивает и убирает повторы', () => {
    const groups = bookmarkGroups([source({ lines: [4, 1, 4] })]);
    expect(groups[0]!.rows.map((row) => row.line)).toEqual([1, 4]);
  });

  /**
   * Вкладка без закладок в списке не появляется: иначе панель у человека
   * с десятью открытыми файлами состояла бы из одних заголовков.
   */
  it('вкладки без закладок не показывает', () => {
    const groups = bookmarkGroups([
      source({ id: 1, lines: [] }),
      source({ id: 2, title: 'Вторая.md', lines: [1] }),
    ]);
    expect(groups.map((group) => group.tabId)).toEqual([2]);
  });

  /**
   * Порядок групп — порядок вкладок, и активная наверх не поднимается:
   * список, который переставляется при каждом переключении вкладки,
   * читать нельзя.
   */
  it('держит порядок вкладок', () => {
    const groups = bookmarkGroups([
      source({ id: 7, title: 'Первая.md', lines: [1] }),
      source({ id: 3, title: 'Вторая.md', lines: [1] }),
    ]);
    expect(groups.map((group) => group.tabId)).toEqual([7, 3]);
  });

  /** Строка бывает длиной в мегабайт — родня Р-101. */
  it('обрезает длинную строку', () => {
    const long = 'а'.repeat(5000);
    const groups = bookmarkGroups([
      source({ lines: [1], lineCount: 1, lineText: () => long }),
    ]);
    expect(groups[0]!.rows[0]!.text).toHaveLength(200);
  });

  it('считает закладки всех вкладок', () => {
    const groups = bookmarkGroups([
      source({ id: 1, lines: [1, 2] }),
      source({ id: 2, title: 'Вторая.md', lines: [4] }),
    ]);
    expect(bookmarkCount(groups)).toBe(3);
  });

  it('пустой список — пустой', () => {
    expect(bookmarkGroups([])).toEqual([]);
    expect(bookmarkCount([])).toBe(0);
  });
});
