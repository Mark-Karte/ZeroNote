import type { EditorState } from '@codemirror/state';

import { closesFrontmatter, frontmatterLines } from './frontmatter';

/**
 * Счётчик слов в строке состояния (задача 149).
 *
 * **Правила — Obsidian 1.13** (его встроенный «Подсчёт слов» в `app.js`),
 * чтобы число в двух программах совпадало:
 *
 * - слово — ряд букв, апострофов и дефисов, числа с разделителями
 *   `1,000.50` входят в него же: `кто-то`, `don't`, `Rust1.88` — по слову;
 * - японская кана и китайские иероглифы (и тибетское письмо) — каждый
 *   знак словом: пробелов между словами там нет;
 * - знаки — длина текста целиком, с пробелами и переносами строк;
 * - frontmatter заметки не считается — ни словами, ни знаками;
 * - есть выделение — считается выделенное.
 *
 * Одно отличие: ряд без единой буквы и цифры — одинокий дефис маркера
 * списка, апостроф — словом у нас не считается. У Obsidian `- пункт` —
 * два слова, и список в сто пунктов прибавлял сотню «слов».
 */

/** Знаки, которые Obsidian считает словом каждый. Собраны из кодов: в исходнике запись `\u` превратилась бы при записи в сами знаки. */
const ONE_PER_WORD = [
  [0x0f00, 0x0f00],
  [0x0f40, 0x0f47],
  [0x0f49, 0x0f6c],
  [0x0f88, 0x0f8c],
  [0x3041, 0x3096],
  [0x309d, 0x309f],
  [0x30a1, 0x30fa],
  [0x30fc, 0x30ff],
  [0x4e00, 0x9fd5],
]
  .map(([from, to]) => `${String.fromCodePoint(from!)}-${String.fromCodePoint(to!)}`)
  .join('');

/**
 * Слово: ряд из чисел с разделителями, букв, дефисов и апострофов —
 * кроме знаков, которые сами по себе слово. Повтор здесь однозначный:
 * каждая ветка съедает хотя бы один знак и ветки не перекрываются
 * по началу, так что отката квадратом нет (Р-304).
 */
const WORD = new RegExp(
  `(?:[0-9]+(?:[,.][0-9]+)*|(?![${ONE_PER_WORD}])[-'’\\p{L}])+|[${ONE_PER_WORD}]`,
  'gu',
);

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export function countWords(text: string): number {
  let count = 0;
  for (const match of text.matchAll(WORD)) {
    if (LETTER_OR_DIGIT.test(match[0])) count += 1;
  }
  return count;
}

/**
 * Где начинается то, что считается: за frontmatter у заметки, с начала —
 * у простого текста. Незакрытый frontmatter — не frontmatter: его сейчас
 * пишут, и текст под ним — текст (так же его показывает превью, Р-291).
 */
export function countedFrom(state: EditorState, markdown: boolean): number {
  if (!markdown) return 0;
  const lines = frontmatterLines(state.doc.iterLines());
  if (lines === 0 || !closesFrontmatter(state.doc.line(lines).text)) return 0;
  return lines === state.doc.lines ? state.doc.length : state.doc.line(lines + 1).from;
}

export interface Counts {
  words: number;
  chars: number;
}

/** Слова и знаки всего текста — без frontmatter у заметки. */
export function countAll(state: EditorState, markdown: boolean): Counts {
  const text = state.doc.sliceString(countedFrom(state, markdown));
  return { words: countWords(text), chars: text.length };
}

/**
 * Слова и знаки выделенного; `null` — выделения нет. Несколько
 * выделений — вместе, через перенос строки, как у их копирования.
 */
export function countSelection(state: EditorState): Counts | null {
  const parts = state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to));
  if (parts.length === 0) return null;
  const text = parts.join('\n');
  return { words: countWords(text), chars: text.length };
}
