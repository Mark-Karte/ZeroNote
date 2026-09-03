/**
 * Отступы: чем набирается новый и что об этом говорит файл.
 *
 * Главное правило — Р-106: **отступ определяется по содержимому файла,
 * а настройка задаёт умолчание.** Настройка «два пробела», применённая
 * к чужому файлу с табами, означала бы, что первое же нажатие `Tab` смешает
 * в нём одно с другим. Файл станет другим не от команды пользователя,
 * а от того, что у нас в конфиге, — это прямое нарушение инварианта 1.
 *
 * То же правило, по которому уже живут кодировка и перенос строк: файл
 * диктует, настройка подсказывает.
 */

export type IndentStyle = 'tabs' | 'spaces';

export interface Indent {
  style: IndentStyle;
  /** Для пробелов — сколько их в отступе; для табов — во сколько он шириной. */
  width: number;
  /** Откуда взялось: по файлу, из настроек или выбрано руками в строке состояния. */
  source: 'detected' | 'settings' | 'manual';
}

/**
 * Сколько строк смотрим при определении.
 *
 * Ограничение не из осторожности, а по инварианту 6: файл открывается
 * мгновенно и на десяти мегабайтах тоже, а отступ по первым пяти тысячам
 * строк угадывается ровно так же, как по всем.
 */
const MAX_LINES = 5000;

/** Что нашлось в файле. `null` — отступов нет вовсе, гадать не о чем. */
export function detectIndent(text: string): { style: 'tabs' } | { style: 'spaces'; width: number } | null {
  let tabs = 0;
  let spaced = 0;

  /** Насколько отступ вырос по сравнению с предыдущей строкой — и сколько раз. */
  const steps = new Map<number, number>();
  /** Сколько раз встретился каждый размер отступа: запасной путь. */
  const sizes = new Map<number, number>();

  let previous = 0;
  let pos = 0;
  let seen = 0;

  while (pos <= text.length && seen < MAX_LINES) {
    const end = text.indexOf('\n', pos);
    const stop = end === -1 ? text.length : end;
    seen += 1;

    let i = pos;
    let spaces = 0;
    let hasTab = false;

    while (i < stop) {
      const ch = text[i];
      if (ch === '\t') {
        hasTab = true;
        break;
      }
      if (ch !== ' ') break;
      spaces += 1;
      i += 1;
    }

    // Пустая строка ничего не говорит об отступе — в ней его просто нет.
    const blank = i >= stop && !hasTab;

    if (hasTab) {
      tabs += 1;
    } else if (!blank) {
      if (spaces > 0) {
        spaced += 1;
        sizes.set(spaces, (sizes.get(spaces) ?? 0) + 1);
        if (spaces > previous) {
          const step = spaces - previous;
          steps.set(step, (steps.get(step) ?? 0) + 1);
        }
      }
      previous = spaces;
    }

    if (end === -1) break;
    pos = end + 1;
  }

  if (tabs === 0 && spaced === 0) return null;
  if (tabs >= spaced) return { style: 'tabs' };

  return { style: 'spaces', width: mostCommon(steps) ?? mostCommon(sizes) ?? 4 };
}

/**
 * Чаще всего встречающееся значение.
 *
 * При равенстве побеждает большее: в файле с отступом в четыре пробела
 * уровни кратны и двум, и четырём, а верный ответ — четыре.
 */
function mostCommon(counts: Map<number, number>): number | null {
  let best: number | null = null;
  let bestCount = 0;

  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value > best)) {
      best = value;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Отступ, который действует в этом файле.
 *
 * Ширину таба определить по содержимому нельзя — таб один и тот же знак
 * независимо от того, во сколько его рисуют. Поэтому у файла с табами ширина
 * берётся из настроек: это и правда предпочтение, а не свойство файла.
 */
export function resolveIndent(text: string, fallback: { style: IndentStyle; width: number }): Indent {
  const found = detectIndent(text);
  if (!found) return { ...fallback, source: 'settings' };

  if (found.style === 'tabs') {
    return { style: 'tabs', width: fallback.width, source: 'detected' };
  }
  return { style: 'spaces', width: found.width, source: 'detected' };
}

/** Строка, которой набирается один уровень отступа. */
export function indentUnitOf(indent: Indent): string {
  return indent.style === 'tabs' ? '\t' : ' '.repeat(Math.max(1, indent.width));
}

/**
 * Столбец, в котором стоит курсор, с учётом табуляции.
 *
 * Считается по знакам до курсора: таб доводит до следующей позиции
 * табуляции, остальное — по одному столбцу на знак. Нужно затем, чтобы
 * `Tab` дописывал до ближайшей позиции табуляции, а не всегда одинаковое
 * число пробелов.
 */
export function columnAt(before: string, tabSize: number): number {
  let column = 0;
  for (const ch of before) {
    column = ch === '\t' ? column + tabSize - (column % tabSize) : column + 1;
  }
  return column;
}

/** Что вставить по `Tab` в позиции с таким столбцом. */
export function tabInsertion(indent: Indent, column: number): string {
  if (indent.style === 'tabs') return '\t';

  const width = Math.max(1, indent.width);
  return ' '.repeat(width - (column % width));
}

/** Подпись для строки состояния. */
export function indentLabel(indent: Indent): string {
  return indent.style === 'tabs' ? `Табы: ${indent.width}` : `Пробелы: ${indent.width}`;
}

/** Откуда взялся отступ — словами, для подсказки. */
export function indentSource(indent: Indent): string {
  switch (indent.source) {
    case 'detected':
      return 'Определён по содержимому файла';
    case 'manual':
      return 'Выбран вручную для этой вкладки';
    case 'settings':
      return 'Из настроек: в файле отступов не нашлось';
  }
}
