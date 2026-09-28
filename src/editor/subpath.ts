import type { Text } from '@codemirror/state';

import { outlineOf, type Heading } from './outline';
import { t } from '../l10n';

/**
 * Раздел в ссылке (задача 148): `[[заметка#Раздел]]`, `[[#Раздел]]`,
 * `[[заметка#Раздел#Подраздел]]`, `[[заметка#^метка]]` — и то же в ссылке
 * markdown `[текст](заметка.md#Раздел)`.
 *
 * **Правила — Obsidian 1.13** (его `resolveSubpath` и `stripHeadingForLink`
 * в `app.js`): ссылки из хранилища, общего с Obsidian, обязаны вести туда
 * же, куда ведут там. Заголовки берутся тем же построчным разбором, что
 * оглавление (Р-139), — из того, что открыто во вкладке, со всеми
 * несохранёнными правками.
 */

/** Знаки, которые Obsidian при сравнении заголовков заменяет пробелом. */
const LOOSE = /[!"#$%&()*+,.:;<=>?@^`{|}~/[\]\\\r\n]/g;

/** Чего не бывает в тексте ссылки: оно закрыло бы её раньше времени. */
const NOT_IN_LINK = /([:#|^\\\r\n]|%%|\[\[|]])/g;

/** Заголовок в виде для сравнения: знаки — пробелом, регистр — нижний. */
function loose(text: string): string {
  return text.replace(LOOSE, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Текст заголовка для ссылки — то, что вставляет подсказка после `#`.
 * `Итоги: 2026` становится `Итоги 2026`: двоеточие Obsidian в ссылку
 * не пускает, а сравнение (`loose`) их всё равно сочтёт одним.
 */
export function headingForLink(text: string): string {
  return text.replace(NOT_IN_LINK, ' ').replace(/\s+/g, ' ').trim();
}

/** Цель ссылки на путь и раздел: `а#б#в` — `а` и `#б#в`. */
export function splitSubpath(target: string): { path: string; subpath: string } {
  const at = target.indexOf('#');
  return at < 0
    ? { path: target, subpath: '' }
    : { path: target.slice(0, at), subpath: target.slice(at) };
}

/**
 * Якорь GitHub: нижний регистр, всё, кроме букв, цифр, пробела, дефиса
 * и подчёркивания, выброшено, пробелы — дефисами. Так пишут оглавления
 * README: `[Установка](#быстрая-установка)`. У Obsidian этого правила нет,
 * а в редакторе, который открывает и код, такие ссылки встречаются чаще,
 * чем правило Obsidian, — поэтому запасным путём.
 */
function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Метка блока в конце строки: `…текст ^метка`. */
const BLOCK_ID = /(?:^|\s)\^([A-Za-z0-9-]+)$/;

/** Строка, которая кончается меткой `^id`, — без учёта регистра, как у Obsidian. */
function findBlock(doc: Text, id: string): number | null {
  const wanted = id.toLowerCase();
  let position = 0;
  for (const line of doc.iterLines()) {
    const found = BLOCK_ID.exec(line.trimEnd());
    if (found && found[1]!.toLowerCase() === wanted) return position;
    position += line.length + 1;
  }
  return null;
}

/**
 * Начало строки, на которую ведёт раздел ссылки. `null` — такого раздела
 * в тексте нет.
 *
 * `#Раздел#Подраздел` — части ищутся по порядку, и каждая следующая —
 * среди заголовков глубже найденной, как у Obsidian: одинаковые
 * подзаголовки в разных разделах так различаются.
 */
export function findSubpath(doc: Text, subpath: string, headings?: Heading[]): number | null {
  const parts = subpath.split('#').filter((part) => part !== '');
  if (parts.length === 0) return null;
  if (parts.length === 1 && parts[0]!.startsWith('^')) return findBlock(doc, parts[0]!.slice(1));

  const items = headings ?? outlineOf(doc);
  let index = 0;
  let level = 0;
  for (const heading of items) {
    if (heading.level > level && loose(heading.text) === loose(parts[index]!)) {
      index += 1;
      level = heading.level;
      if (index === parts.length) return heading.from;
    }
  }

  if (parts.length === 1) {
    const wanted = parts[0]!.toLowerCase();
    const found = items.find((heading) => githubSlug(heading.text) === wanted);
    if (found) return found.from;
  }
  return null;
}

/** Заголовок в подсказке после `[[заметка#` (задача 148). */
export interface HeadingHit {
  text: string;
  level: number;
  /** Позиции совпавших букв в `text`, в символах, — для подсветки. */
  matched: number[];
}

/**
 * Заголовки, в которых есть набранное, — по порядку в заметке: подсказка
 * раздела читается как оглавление, а не как выдача поиска. Пустой запрос —
 * все заголовки.
 */
export function matchHeadings(headings: readonly Heading[], query: string, limit = 50): HeadingHit[] {
  const wanted = query.trim().toLowerCase();
  const out: HeadingHit[] = [];
  for (const heading of headings) {
    const chars = [...heading.text];
    const lower = chars.map((char) => char.toLowerCase());
    let at = -1;
    if (wanted !== '') {
      const want = [...wanted];
      for (let i = 0; i + want.length <= lower.length && at < 0; i += 1) {
        if (want.every((char, k) => lower[i + k] === char)) at = i;
      }
      if (at < 0) continue;
    }
    const matched = at < 0 ? [] : [...wanted].map((_, k) => at + k);
    out.push({ text: heading.text, level: heading.level, matched });
    if (out.length >= limit) break;
  }
  return out;
}

/** Фраза для полосы, когда раздела нет: заголовок или метка — по виду. */
export function missingSubpath(subpath: string): string {
  const text = subpath.replace(/^#+/, '');
  return text.startsWith('^')
    ? t('link.no-block', { name: text })
    : t('link.no-heading', { name: text });
}
