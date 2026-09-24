import type { Parser, SyntaxNode } from '@lezer/common';
import { highlightCode, tagHighlighter } from '@lezer/highlight';

import { CODE_ROLES } from '../theme/syntax';
import { escapeHtml } from './escape';
import type { Source } from './source';

/**
 * Код в выводе HTML (задача 108): блок кода в заметке и файл кода целиком.
 *
 * Путь один на оба случая — через одну точку по языку, — и туда же потом
 * встанет отрисовка схем mermaid (решение владельца: следующие этапы),
 * а не вторая ветка рядом.
 *
 * Раскраска — классами `zn-syn-роль`, а не цветами: роли те же, что
 * у редактора (`CODE_ROLES`), а цвет даёт стиль документа тем же токеном.
 * Так смена темы печати не требует пересборки HTML.
 */

const highlighter = tagHighlighter(
  CODE_ROLES.map(({ tag, role }) => ({ tag, class: `zn-syn-${role}` })),
);

/**
 * Код строками: каждая строка — `<span class="zn-line">`, блоком.
 *
 * Строками, а не одним текстом, — ради номеров строк при печати файла кода:
 * их рисует счётчик CSS, и в тексте документа номеров нет. Скопированный
 * из напечатанного код не приносит с собой цифр.
 *
 * Строка — блок, и перевода строки между ними нет (задача 109): у длинной
 * строки, перенесённой на бумаге, хвост встаёт под текстом, а не под
 * номером. Перевод строки между блоками внутри `<pre>` дал бы пустую
 * строку; пустая строка кода держит высоту своим `<br>`.
 *
 * `parser` — `null`, когда язык не узнан: тогда текст без раскраски.
 */
export function highlightedLines(code: string, parser: Parser | null): string {
  const lines: string[] = [];
  let line = '';

  const putText = (text: string, classes: string): void => {
    const escaped = escapeHtml(text);
    line += classes ? `<span class="${classes}">${escaped}</span>` : escaped;
  };
  const putBreak = (): void => {
    lines.push(line);
    line = '';
  };

  if (parser === null) {
    code.split('\n').forEach((text, index) => {
      if (index > 0) putBreak();
      putText(text, '');
    });
  } else {
    highlightCode(code, parser.parse(code), highlighter, putText, putBreak);
  }
  lines.push(line);

  return lines.map((text) => `<span class="zn-line">${text === '' ? '<br>' : text}</span>`).join('');
}

/**
 * Блок кода целиком: `<pre>` с языком в атрибуте, если он есть.
 * `numbered` — с номерами строк: у файла кода их рисует стиль документа
 * по тому же правилу, что на экране (Р-213, Р-214).
 */
export function codeBlock(lines: string, language: string | null, numbered = false): string {
  const lang = language ? ` data-lang="${escapeHtml(language)}"` : '';
  const cls = numbered ? 'zn-code zn-code-numbered' : 'zn-code';
  return `<pre class="${cls}"${lang}><code>${lines}</code></pre>`;
}

/**
 * Текст блока кода без ограды и без знаков контейнера.
 *
 * Строки кода внутри цитаты несут `> ` — это знак цитаты, а не код; внутри
 * списка — отступ пункта. Разбор знает про первое (`QuoteMark` среди детей
 * блока), второе снимается по колонке открывающей ограды, как велит
 * CommonMark: у каждой строки убирается не больше пробелов, чем стоит
 * перед оградой.
 */
export function fencedBody(node: SyntaxNode, source: Source): string {
  const marks = node.getChildren('CodeMark');
  const opening = marks[0];
  if (!opening) return '';

  // Тело начинается со строки после открывающей ограды.
  const firstBreak = source.indexOf('\n', opening.to);
  if (firstBreak < 0 || firstBreak >= node.to) return '';

  // Закрывающая ограда — последняя `CodeMark`, если блок дописан; тело
  // кончается перед её строкой. Недописанный блок идёт до конца узла.
  const closing = marks.length > 1 ? marks[marks.length - 1]! : null;
  const end = closing ? source.lastIndexOf('\n', closing.from) : node.to;
  if (end <= firstBreak) return '';

  const cut = quoteMarks(node, source);
  const indent = column(source, opening.from, cut);
  return bodyLines(source, firstBreak + 1, end, indent, cut);
}

/**
 * Текст блока кода, записанного отступом. Отступ самого блока (четыре
 * пробела) — не код; колонка берётся у первой строки, где разбор начал блок.
 */
export function indentedBody(node: SyntaxNode, source: Source): string {
  const cut = quoteMarks(node, source);
  const indent = column(source, node.from, cut);
  const first = source.lastIndexOf('\n', node.from - 1) + 1;
  return bodyLines(source, first, node.to, indent, cut);
}

/** Знаки цитаты среди детей блока — вместе с одним пробелом за каждым. */
function quoteMarks(node: SyntaxNode, source: Source): Array<[number, number]> {
  return node.getChildren('QuoteMark').map((quote) => {
    const space = source.char(quote.to) === ' ' ? 1 : 0;
    return [quote.from, quote.to + space];
  });
}

/** Колонка места в его строке — после знаков цитаты. */
function column(source: Source, at: number, cut: Array<[number, number]>): number {
  const lineStart = source.lastIndexOf('\n', at - 1) + 1;
  return stripped(source, lineStart, at, cut).length;
}

/** Строки отрезка `[from, to)`: без знаков цитаты и без отступа блока. */
function bodyLines(
  source: Source,
  from: number,
  to: number,
  indent: number,
  cut: Array<[number, number]>,
): string {
  const lines: string[] = [];
  let start = from;
  for (;;) {
    const lineEnd = source.indexOf('\n', start);
    const stop = lineEnd < 0 || lineEnd > to ? to : lineEnd;
    lines.push(dedent(stripped(source, start, stop, cut), indent));
    if (stop >= to) break;
    start = stop + 1;
  }
  return lines.join('\n');
}

/** Кусок строки без вырезанных знаков цитаты. */
function stripped(source: Source, from: number, to: number, cut: Array<[number, number]>): string {
  let text = '';
  let pos = from;
  for (const [a, b] of cut) {
    if (b <= pos || a >= to) continue;
    if (a > pos) text += source.slice(pos, a);
    pos = Math.max(pos, b);
  }
  if (pos < to) text += source.slice(pos, to);
  return text.replace(/\r$/, '');
}

/** Снять не больше `count` пробелов в начале строки. */
function dedent(text: string, count: number): string {
  let index = 0;
  while (index < count && text[index] === ' ') index += 1;
  return text.slice(index);
}
