import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { TREE_CHANGED, TREE_STALE } from '../src/ipc/tree';
import { tree, expandedUnder } from '../src/state/tree.svelte';

/**
 * События дерева (задача 140).
 *
 * Имя события — строка на двух сторонах: `tree/watch.rs` в ядре и
 * `ipc/tree.ts` во фронтенде. Опечатка в одной из них глушит событие
 * молча — слушатель просто ничего не получает.
 */
const WATCH = readFileSync('src-tauri/src/tree/watch.rs', 'utf8');

function coreEvent(name: string): string | undefined {
  return new RegExp(`pub const ${name}: &str = "([^"]+)";`).exec(WATCH)?.[1];
}

describe('события дерева', () => {
  it('названы одинаково в ядре и во фронтенде', () => {
    expect(coreEvent('TREE_CHANGED')).toBe(TREE_CHANGED);
    expect(coreEvent('TREE_STALE')).toBe(TREE_STALE);
  });

  /**
   * Корень могли сверить догоняющим проходом (Я15) — перечитать надо всё
   * раскрытое под ним, и только под ним. Регистр путей Windows не различает.
   */
  it('перечитывается раскрытое под устаревшим корнем', () => {
    tree.expanded = [
      String.raw`C:\Заметки`,
      String.raw`C:\Заметки\работа`,
      String.raw`C:\Заметки-2\чужое`,
      String.raw`D:\Проект\src`,
    ];

    expect(expandedUnder([String.raw`c:\заметки`])).toEqual([
      String.raw`C:\Заметки`,
      String.raw`C:\Заметки\работа`,
    ]);
    expect(expandedUnder([])).toEqual([]);
  });
});
