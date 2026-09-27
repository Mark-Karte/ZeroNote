import { describe, expect, it } from 'vitest';

import { listItem, readProperties, splitKey } from '../src/editor/properties';
import { wikilinkSpans } from '../src/editor/wikilinks';

/**
 * Разбор на пути ввода — за линейное время (Р7 ревизии).
 *
 * Прежние выражения откатывались квадратично: строка frontmatter из `a`
 * и пятидесяти тысяч пробелов разбиралась секунду, ряд из пятидесяти
 * тысяч `[` — тоже, а свойства разбирает поле блочного превью на каждое
 * нажатие, ссылки — плагин превью на каждую пересборку. Замерено на V8
 * до правки: 1,1–1,4 с на вызов. Чужая заметка подвешивала окно.
 *
 * Разбор теперь ручной, и сверяется с прежними выражениями на тысячах
 * случайных строк: правило обязано остаться тем же, поменялась только цена.
 */

const N = 50_000;
const LIMIT_MS = 100;

function took(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

/** Прежние выражения — образец правила. */
const OLD_KEY = /^([^\s#:'"\-?[\]{},&*!|>%@`][^:]*?)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
const OLD_ITEM = /^[ \t]*-(?:[ \t]+(.*?))?[ \t]*$/;
const OLD_LINK = /\[\[([^\]\n]+)\]\]/g;

/** Случайная строка из знаков, на которых правила и различаются. */
function random(alphabet: readonly string[], length: number, seed: { value: number }): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    // Простой линейный конгруэнтный генератор: повторяемо от прогона
    // к прогону. Берутся старшие биты — младшие у него ходят по короткому
    // кругу, и строки выходили однообразными.
    seed.value = (seed.value * 1103515245 + 12345) % 2147483648;
    out += alphabet[(seed.value >>> 16) % alphabet.length];
  }
  return out;
}

describe('разбор без квадратичного отката', () => {
  it('ключ из пробелов без двоеточия', () => {
    expect(took(() => readProperties(['a' + ' '.repeat(N) + 'b']))).toBeLessThan(LIMIT_MS);
  });

  it('значение с длинным пробельным отрезком', () => {
    expect(took(() => readProperties(['a: x' + ' '.repeat(N) + 'y']))).toBeLessThan(LIMIT_MS);
  });

  it('пункт списка с длинным пробельным отрезком', () => {
    expect(took(() => readProperties(['k:', '- x' + ' '.repeat(N) + 'y']))).toBeLessThan(LIMIT_MS);
  });

  it('ряд скобок без закрытия и с одной в конце', () => {
    expect(took(() => wikilinkSpans('['.repeat(N)))).toBeLessThan(LIMIT_MS);
    expect(took(() => wikilinkSpans('['.repeat(N) + ']'))).toBeLessThan(LIMIT_MS);
    expect(took(() => wikilinkSpans('['.repeat(N) + ']]'))).toBeLessThan(LIMIT_MS);
  });
});

describe('ручной разбор — то же правило, что прежние выражения', () => {
  it('ключ', () => {
    const seed = { value: 7 };
    const alphabet = [' ', '\t', ':', ': ', 'a', 'аб', 'б', '-', '#', '"', '[', '?'];
    let matched = 0;
    for (let i = 0; i < 5000; i += 1) {
      const line = random(alphabet, 1 + (i % 12), seed);
      const old = OLD_KEY.exec(line);
      const expected = old ? [old[1] ?? '', old[2] ?? ''] : null;
      if (old) matched += 1;
      expect(splitKey(line), JSON.stringify(line)).toEqual(expected);
    }
    // Сверка не пустая: совпадений среди случайных строк достаточно.
    expect(matched).toBeGreaterThan(200);
  });

  it('пункт списка', () => {
    const seed = { value: 11 };
    const alphabet = [' ', '\t', '-', 'a', 'б', ':'];
    let matched = 0;
    for (let i = 0; i < 5000; i += 1) {
      const line = random(alphabet, 1 + (i % 10), seed);
      const old = OLD_ITEM.exec(line);
      const expected = old ? (old[1] ?? '') : null;
      if (old) matched += 1;
      expect(listItem(line), JSON.stringify(line)).toEqual(expected);
    }
    expect(matched).toBeGreaterThan(200);
  });

  it('вики-ссылка', () => {
    const seed = { value: 13 };
    // Составные куски — чтобы `[[…]]` среди случайных строк встречались
    // часто, а не по разу на сотню.
    const alphabet = ['[[', ']]', '[', ']', '\n', 'a', 'аб', '!', '|', ' '];
    let matched = 0;
    for (let i = 0; i < 5000; i += 1) {
      const text = random(alphabet, 1 + (i % 24), seed);
      const expected: [number, number, string][] = [];
      OLD_LINK.lastIndex = 0;
      for (let m = OLD_LINK.exec(text); m !== null; m = OLD_LINK.exec(text)) {
        expected.push([m.index, m.index + m[0].length, m[1] ?? '']);
      }
      const found = wikilinkSpans(text).map((span): [number, number, string] => [span.from, span.to, span.inner]);
      matched += expected.length;
      expect(found, JSON.stringify(text)).toEqual(expected);
    }
    expect(matched).toBeGreaterThan(200);
  });
});
