import type { Text } from '@codemirror/state';

/**
 * Оглавление документа: заголовки markdown списком.
 *
 * Разбор свой, построчный, а не по дереву разбора Lezer. Причина в инварианте
 * 6: дерево у больших файлов разобрано только до видимой части, и требовать
 * полного разбора значило бы ждать его на каждую перерисовку панели.
 * Проход по строкам стоит предсказуемо и не зависит от того, докуда
 * добрался ленивый разбор.
 *
 * **Только заголовки решёткой.** Подчёркнутые (`Заголовок` и строка из `=`
 * или `-` под ним) не берём: отличить их от горизонтальной черты и от
 * разделителя таблицы можно, только зная контекст блока, а разбор, который
 * угадывает, показал бы заголовки там, где их нет. Решёткой пишут и наши
 * собственные команды разметки (задача 43).
 */

export interface Heading {
  /** Уровень 1…6 — по числу решёток. */
  level: number;
  /** Текст заголовка без решёток и без хвостовой ограды. */
  text: string;
  /** Позиция начала строки в документе: по ней ставится курсор. */
  from: number;
  /** Номер строки, считая с единицы. */
  line: number;
}

/** Ограда огороженного блока кода: три и более знака с отступом не больше трёх. */
function fence(line: string): string | null {
  const indent = line.length - line.trimStart().length;
  if (indent > 3) return null;

  const trimmed = line.trimStart();
  const marker = trimmed[0];
  if (marker !== '`' && marker !== '~') return null;

  let count = 0;
  while (trimmed[count] === marker) count += 1;
  return count >= 3 ? marker : null;
}

/**
 * Разобрать строку в заголовок.
 *
 * Пробел после решёток обязателен, и это не придирка к стандарту: без него
 * `#работа` в начале строки — тег, а не заголовок первого уровня. Теги
 * с начала строки в заметках пишут постоянно.
 */
function heading(line: string): { level: number; text: string } | null {
  const indent = line.length - line.trimStart().length;
  // Отступ в четыре пробела — это блок кода, а не заголовок.
  if (indent > 3) return null;

  const trimmed = line.trimStart();
  let level = 0;
  while (trimmed[level] === '#') level += 1;
  if (level === 0 || level > 6) return null;

  const rest = trimmed.slice(level);
  if (rest !== '' && !rest.startsWith(' ') && !rest.startsWith('\t')) return null;

  // Хвостовая ограда `## Заголовок ##` — часть разметки, а не текста.
  const text = rest.trim().replace(/\s+#+$/, '').trim();
  return { level, text };
}

/**
 * Заголовки документа по порядку.
 *
 * Пропускается frontmatter (там свои ключи, а не заголовки) и содержимое
 * огороженных блоков кода: `# комментарий` в примере на shell заголовком
 * не является. Те же два правила, что и у разбора ссылок в ядре (Р-069).
 */
export function outlineOf(doc: Text): Heading[] {
  const out: Heading[] = [];

  let position = 0;
  let number = 0;
  let inFence: string | null = null;
  let front: 'maybe' | 'inside' | 'done' = 'maybe';

  for (const line of doc.iterLines()) {
    number += 1;
    const start = position;
    position += line.length + 1;

    if (front !== 'done') {
      if (front === 'maybe') {
        // Ограда frontmatter — только самая первая строка файла.
        front = number === 1 && line.trimEnd() === '---' ? 'inside' : 'done';
        if (front === 'inside') continue;
      } else {
        if (line.trimEnd() === '---') front = 'done';
        continue;
      }
    }

    const marker = fence(line);
    if (inFence !== null) {
      // Закрывает ограду только такая же: `~~~` внутри ``` — обычный текст.
      if (marker === inFence) inFence = null;
      continue;
    }
    if (marker !== null) {
      inFence = marker;
      continue;
    }

    const found = heading(line);
    // Пустой заголовок — одни решётки — в оглавлении не строка, а загадка.
    if (found && found.text !== '') {
      out.push({ level: found.level, text: found.text, from: start, line: number });
    }
  }

  return out;
}

/**
 * Какой заголовок сейчас над курсором.
 *
 * Возвращает номер в списке или `-1`, если курсор выше первого заголовка.
 * Именно «над», а не «ближайший»: раздел начинается заголовком и тянется
 * до следующего, и текст под последним заголовком принадлежит ему.
 */
export function activeHeading(items: Heading[], line: number): number {
  let found = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (items[i]!.line > line) break;
    found = i;
  }
  return found;
}
