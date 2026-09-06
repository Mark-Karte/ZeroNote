import type { IconName } from '../icons/registry';

/**
 * Callout-ы Obsidian: `> [!tip] Совет` показывается карточкой.
 *
 * Разбор здесь чистыми функциями, чтобы проверяться тестом без окна.
 * Рисование — в `live-preview.ts`, рядом с прочей разметкой.
 *
 * **Своего узла разбора у callout-а нет, и это решение, а не упрощение.**
 * Callout — не новый синтаксис: это обычная цитата, у которой первая строка
 * написана в известном виде. Разбор цитат уже есть, вложенность и ленивое
 * продолжение он считает сам; свой блочный разбор пришлось бы поставить
 * вместо него целиком — ради строки, которую мы всё равно прячем.
 * `==выделение==` (Р-154) отличается тем, что там разбора не было вовсе.
 */

/** Роль callout-а: цвет и значок. */
export type CalloutKind = 'note' | 'tip' | 'warning' | 'danger' | 'quote';

/**
 * Тип из файла → роль.
 *
 * У Obsidian типов около полутора десятков, и половина из них — синонимы
 * с одним и тем же цветом. Ролей пять: заметка, подсказка, внимание,
 * опасность, цитата. Незнакомый тип становится заметкой — карточка
 * с непонятным цветом лучше, чем строка `[!придумал]` посреди текста.
 */
const KINDS: Record<string, CalloutKind> = {
  note: 'note',
  info: 'note',
  abstract: 'note',
  summary: 'note',
  todo: 'note',
  example: 'note',

  tip: 'tip',
  hint: 'tip',
  success: 'tip',
  check: 'tip',
  done: 'tip',

  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  question: 'warning',
  help: 'warning',
  faq: 'warning',

  danger: 'danger',
  error: 'danger',
  bug: 'danger',
  failure: 'danger',
  fail: 'danger',
  missing: 'danger',

  quote: 'quote',
  cite: 'quote',
};

/** Значок роли. Рисуется вместо знака `[!тип]`. */
export const CALLOUT_ICON: Record<CalloutKind, IconName> = {
  note: 'md.callout-note',
  tip: 'md.callout-tip',
  warning: 'md.callout-warning',
  danger: 'md.callout-danger',
  quote: 'md.callout-quote',
};

/** Найденный знак callout-а. Смещения — от начала переданной строки. */
export interface CalloutMarker {
  /** Тип как написан в файле, в нижнем регистре. */
  type: string;
  kind: CalloutKind;
  /** Начало `[`. */
  from: number;
  /** Конец знака вместе со свёрткой `+`/`-` и одним пробелом за ним. */
  to: number;
}

/**
 * Разобрать первую строку цитаты.
 *
 * `null` — обычная цитата. Угловые скобки в начале допускаются любые:
 * callout бывает и вложенным.
 *
 * Знак свёртки `+`/`-` разбирается, но ничего не делает: свёртка callout-ов
 * — это своё состояние на блок, а у нас свёртка уже есть и идёт от разбора
 * языка (задача 33). Разбирается он затем, чтобы не остаться на экране.
 */
export function parseCallout(line: string): CalloutMarker | null {
  const match = /^(?:\s*>)+\s*(\[!([^\]\s]+)\][+-]? ?)/.exec(line);
  if (!match) return null;

  const whole = match[1] ?? '';
  const type = (match[2] ?? '').toLowerCase();
  // Знак стоит в конце совпадения: перед ним угловые скобки и пробелы.
  const from = match[0].length - whole.length;

  return {
    type,
    kind: KINDS[type] ?? 'note',
    from,
    to: from + whole.length,
  };
}
