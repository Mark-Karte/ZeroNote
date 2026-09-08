import { beforeEach, describe, expect, it } from 'vitest';
import {
  canUndoReplace,
  lastReplace,
  remember,
  resetReplaceHistory,
  takeLastReplace,
  undoable,
  type DoneReplace,
} from '../src/state/replace.svelte';

/**
 * Стек отмены замен по проекту (задача 88).
 *
 * Владелец просил помнить пять последних замен, пока приложение открыто.
 * Число здесь и есть содержание: шестая замена обязана вытеснить первую,
 * а не остановить запись, — иначе отмена перестала бы работать после пятой
 * замены, ничего об этом не сказав.
 */

function done(query: string, files = 1): DoneReplace {
  return {
    query,
    replacement: 'замысел',
    expression: false,
    matches: files,
    undo: Array.from({ length: files }, (_, i) => ({
      path: String.raw`C:\проект\файл-` + i + '.md',
      inside: `файл-${i}.md`,
      edits: [{ offset: 0, was: 'замысел', becomes: query }],
    })),
  };
}

beforeEach(() => {
  resetReplaceHistory();
});

describe('стек замен', () => {
  it('пуст, пока замен не было', () => {
    expect(canUndoReplace()).toBe(false);
    expect(lastReplace()).toBeNull();
    expect(takeLastReplace()).toBeNull();
  });

  it('снимает последнюю замену', () => {
    remember(done('первая'));
    remember(done('вторая'));

    expect(lastReplace()?.query).toBe('вторая');
    expect(takeLastReplace()?.query).toBe('вторая');
    expect(takeLastReplace()?.query).toBe('первая');
    expect(canUndoReplace()).toBe(false);
  });

  /** Пять — решение владельца, шестая вытесняет первую. */
  it('помнит пять последних', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) remember(done(`замена-${n}`));

    expect(undoable.items).toHaveLength(5);
    expect(undoable.items[0]?.query).toBe('замена-2');
    expect(lastReplace()?.query).toBe('замена-6');
  });

  /**
   * Замена, не изменившая ни одного файла, в стек не идёт: отменять нечего,
   * а место в стеке из пяти она бы заняла и вытеснила настоящую.
   */
  it('не помнит замену, ничего не изменившую', () => {
    remember(done('настоящая'));
    remember({
      query: 'пустая',
      replacement: 'что-то',
      expression: false,
      matches: 0,
      undo: [],
    });

    expect(undoable.items).toHaveLength(1);
    expect(lastReplace()?.query).toBe('настоящая');
  });
});
