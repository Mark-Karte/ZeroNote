import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MARK_START, MARK_END } from '../src/ipc/index';

/**
 * Пометки совпадений в отрывке задаются в Rust, а разрезает по ним фронтенд.
 * Разойдутся — подсветка результатов поиска молча исчезнет, а вместо неё
 * в тексте появятся невидимые управляющие знаки. Заметить это можно будет
 * только глазами, поэтому сверяем.
 *
 * Тот же приём, что с токенами оформления и списком команд раскладки.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function markFromRust(name: string): string {
  const source = readFileSync(
    join(root, 'src-tauri', 'src', 'index', 'query.rs'),
    'utf8',
  );

  const match = new RegExp(
    `pub const ${name}: &str = "\\\\u\\{([0-9a-fA-F]+)\\}"`,
  ).exec(source);

  expect(match, `константа ${name} не найдена в query.rs`).not.toBeNull();
  return String.fromCodePoint(Number.parseInt(match![1]!, 16));
}

describe('пометки в отрывках поиска', () => {
  it('совпадают с query.rs', () => {
    expect(MARK_START).toBe(markFromRust('MARK_START'));
    expect(MARK_END).toBe(markFromRust('MARK_END'));
  });

  /**
   * Пометка обязана быть тем, что не встречается в текстах пользователя.
   * Возьми мы `<b>` — и файл с разметкой подсветился бы сам собой в случайных
   * местах.
   */
  it('не могут встретиться в обычном тексте', () => {
    for (const mark of [MARK_START, MARK_END]) {
      expect(mark).toHaveLength(1);
      expect(mark.codePointAt(0)).toBeLessThan(0x20);
    }
    expect(MARK_START).not.toBe(MARK_END);
  });
});
