import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  bookmarkLines,
  bookmarks,
  nextBookmark,
  toggleBookmarkEffect,
} from '../src/editor/bookmarks';

/**
 * Закладки живут в состоянии редактора, а не рядом с ним, — и главное, что
 * тут проверяется, это перенос через правку. Список номеров строк, хранимый
 * сбоку, пришлось бы поправлять руками на каждое изменение текста, и первая
 * же забытая правка сделала бы закладки бесполезными.
 */

function stateWith(doc: string, lines: number[] = []): EditorState {
  return EditorState.create({ doc, extensions: bookmarks(lines) });
}

/** Поставить или снять закладку на строке. */
function toggle(state: EditorState, line: number): EditorState {
  return state.update({
    effects: toggleBookmarkEffect.of(state.doc.line(line).from),
  }).state;
}

const DOC = ['раз', 'два', 'три', 'четыре', 'пять'].join('\n');

describe('закладки', () => {
  it('ставятся и снимаются одним и тем же действием', () => {
    let state = stateWith(DOC);
    expect(bookmarkLines(state)).toEqual([]);

    state = toggle(state, 2);
    expect(bookmarkLines(state)).toEqual([2]);

    state = toggle(state, 2);
    expect(bookmarkLines(state)).toEqual([]);
  });

  it('хранятся по порядку, в каком бы порядке их ни ставили', () => {
    let state = stateWith(DOC);
    for (const line of [4, 1, 3]) state = toggle(state, line);

    expect(bookmarkLines(state)).toEqual([1, 3, 4]);
  });

  /**
   * То, ради чего они и живут в состоянии: вставка строк выше сдвигает
   * закладку вместе с её строкой.
   */
  it('едут вместе со строкой при правке выше', () => {
    let state = stateWith(DOC);
    state = toggle(state, 3);

    // Две новые строки в самом начале.
    state = state.update({ changes: { from: 0, insert: 'ноль\nминус\n' } }).state;

    expect(bookmarkLines(state)).toEqual([5]);
    expect(state.doc.line(5).text).toBe('три');
  });

  it('остаются на своей строке при правке ниже', () => {
    let state = stateWith(DOC);
    state = toggle(state, 2);

    const end = state.doc.length;
    state = state.update({ changes: { from: end, insert: '\nшесть' } }).state;

    expect(bookmarkLines(state)).toEqual([2]);
  });

  /**
   * Строку с закладкой удалили — закладка съезжает на то, что оказалось
   * на её месте, и остаётся ровно одной: две метки на одной строке
   * нарисовались бы одна поверх другой и снимались бы одним нажатием.
   */
  it('не задваиваются, когда две строки схлопываются в одну', () => {
    let state = stateWith(DOC);
    state = toggle(state, 2);
    state = toggle(state, 3);

    // Убираем перенос между второй и третьей строкой.
    const from = state.doc.line(2).to;
    state = state.update({ changes: { from, to: from + 1 } }).state;

    expect(bookmarkLines(state)).toEqual([2]);
  });
});

describe('восстановление из сессии', () => {
  it('поднимает закладки по номерам строк', () => {
    expect(bookmarkLines(stateWith(DOC, [2, 4]))).toEqual([2, 4]);
  });

  /** Файл могли укоротить в другой программе, пока приложение было закрыто. */
  it('отбрасывает номера за концом файла', () => {
    expect(bookmarkLines(stateWith(DOC, [2, 99, 0]))).toEqual([2]);
  });
});

describe('переход по закладкам', () => {
  function at(state: EditorState, line: number): EditorState {
    return state.update({ selection: { anchor: state.doc.line(line).from } }).state;
  }

  it('идёт к ближайшей вперёд и назад', () => {
    let state = stateWith(DOC, [1, 3, 5]);
    state = at(state, 3);

    expect(nextBookmark(state, true)).toBe(state.doc.line(5).from);
    expect(nextBookmark(state, false)).toBe(state.doc.line(1).from);
  });

  /**
   * По кругу: иначе обход длинного файла упирается в конец и требует
   * вспоминать, где начало.
   */
  it('за последней идёт первая', () => {
    let state = stateWith(DOC, [1, 3]);
    state = at(state, 4);

    expect(nextBookmark(state, true)).toBe(state.doc.line(1).from);
  });

  it('перед первой идёт последняя', () => {
    let state = stateWith(DOC, [2, 4]);
    state = at(state, 1);

    expect(nextBookmark(state, false)).toBe(state.doc.line(4).from);
  });

  it('без закладок никуда не идёт', () => {
    expect(nextBookmark(stateWith(DOC), true)).toBeNull();
  });
});
