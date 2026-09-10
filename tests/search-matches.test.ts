import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { SearchQuery, search, setSearchQuery } from '@codemirror/search';

import { searchMatchRanges } from '../src/editor/search-matches';

/**
 * Пометки совпадений поиска по файлу (задача 100).
 *
 * Главное здесь — что помечается только видимое: совпадений в большом
 * файле бывают тысячи, и обход всего документа на каждую прокрутку
 * нарушил бы инвариант 6.
 */

const DOC = ['раз line два', 'три line четыре', 'пять line шесть'].join('\n');

function stateWith(query: Partial<ConstructorParameters<typeof SearchQuery>[0]>): EditorState {
  const state = EditorState.create({ doc: DOC, extensions: [search()] });
  return state.update({
    effects: setSearchQuery.of(new SearchQuery({ search: '', ...query })),
  }).state;
}

/** Отрезок всего документа: так плагин видит файл, влезающий в окно. */
function whole(state: EditorState): { from: number; to: number }[] {
  return [{ from: 0, to: state.doc.length }];
}

function found(state: EditorState): string[] {
  return searchMatchRanges(state, whole(state)).map((match) =>
    state.doc.sliceString(match.from, match.to),
  );
}

describe('пометки совпадений поиска', () => {
  it('находят все вхождения в видимом отрезке', () => {
    const state = stateWith({ search: 'line' });
    expect(found(state)).toEqual(['line', 'line', 'line']);
  });

  it('не выходят за пределы видимого', () => {
    const state = stateWith({ search: 'line' });
    const firstLine = state.doc.line(1);
    const matches = searchMatchRanges(state, [{ from: firstLine.from, to: firstLine.to }]);
    expect(matches).toHaveLength(1);
  });

  it('пустой запрос не помечает ничего', () => {
    expect(found(stateWith({ search: '' }))).toEqual([]);
  });

  it('незакрытая скобка в выражении не помечает ничего', () => {
    expect(found(stateWith({ search: '(line', regexp: true }))).toEqual([]);
  });

  it('слушаются переключатели запроса', () => {
    expect(found(stateWith({ search: 'LINE' }))).toHaveLength(3);
    expect(found(stateWith({ search: 'LINE', caseSensitive: true }))).toEqual([]);
    expect(found(stateWith({ search: 'lin', wholeWord: true }))).toEqual([]);
  });

  it('совпадение нулевой длины не помечается', () => {
    // `\b` находит границу слова, а границе нечего подсвечивать: пустое
    // украшение набор украшений принял бы, а на экране оно было бы ничем.
    expect(found(stateWith({ search: '\\b', regexp: true }))).toEqual([]);
  });
});
