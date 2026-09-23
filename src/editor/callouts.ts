import type { IconName } from '../icons/registry';
import { iconNames } from '../icons/registry';

/**
 * Коллауты Obsidian: `> [!tip] Совет` показывается карточкой.
 *
 * Разбор здесь чистыми функциями, чтобы проверяться тестом без окна.
 * Рисование — в `live-preview.ts`, рядом с прочей разметкой.
 *
 * **Своего узла разбора у коллаута нет, и это решение, а не упрощение.**
 * Коллаут — не новый синтаксис: это обычная цитата, у которой первая строка
 * написана в известном виде. Разбор цитат уже есть, вложенность и ленивое
 * продолжение он считает сам; свой блочный разбор пришлось бы поставить
 * вместо него целиком — ради строки, которую мы всё равно прячем.
 *
 * С задачи 103 значок и цвет не зашиты пятью ролями, а берутся из списка
 * человека (`data/callouts.toml`): тип → значок, цвет, подпись.
 */

/** Коллаут из списка — как его присылает ядро. */
export interface CalloutDef {
  /** Тип в нижнем регистре: `tip` для `> [!tip]`. */
  id: string;
  /** Подпись, которую вставка пишет в файл после типа. */
  title: string;
  /** Значок из реестра по логическому имени. */
  icon: string;
  /** Роль темы (`success`) или свой цвет `#rrggbb`. */
  color: string;
}

/** Как рисовать коллаут: значок и цвет выражением CSS. */
export interface CalloutStyle {
  icon: IconName;
  color: string;
}

/**
 * Роль темы → токен. Роль, а не значение: у каждой темы свой зелёный,
 * и «успех» обязан быть зелёным в любой. Тот же список — `COLOR_ROLES`
 * в ядре; что каждый токен объявлен, проверяет тест.
 */
export const COLOR_TOKENS: Record<string, string> = {
  accent: '--zn-color-accent',
  success: '--zn-color-success',
  warning: '--zn-color-warning',
  danger: '--zn-color-danger',
  muted: '--zn-color-fg-muted',
  keyword: '--zn-color-syntax-keyword',
  string: '--zn-color-syntax-string',
  number: '--zn-color-syntax-number',
  type: '--zn-color-syntax-type',
  function: '--zn-color-syntax-function',
};

/** Цвет из файла → значение CSS. Своё `#rrggbb` идёт как есть. */
export function cssColorOf(color: string): string {
  const token = COLOR_TOKENS[color];
  return token ? `var(${token})` : color;
}

const KNOWN_ICONS = new Set<string>(iconNames());

/** Значок из файла → имя из реестра. Незнакомый — значок заметки. */
export function iconOf(name: string): IconName {
  return KNOWN_ICONS.has(name) ? (name as IconName) : 'md.callout-note';
}

/** Значок, с которым рисуется всё, чего в списке нет, если нет и `note`. */
const FALLBACK: CalloutStyle = { icon: 'md.callout-note', color: 'var(--zn-color-accent)' };

/**
 * Как рисовать тип. Незнакомый тип рисуется как `note` — карточка
 * с непонятным цветом лучше, чем строка `[!придумал]` посреди текста;
 * нет и `note` — значком заметки и акцентом.
 */
export type CalloutLookup = (type: string) => CalloutStyle;

export function lookupFor(list: readonly CalloutDef[]): CalloutLookup {
  const styles = new Map<string, CalloutStyle>(
    list.map((def) => [def.id, { icon: iconOf(def.icon), color: cssColorOf(def.color) }]),
  );
  return (type) => styles.get(type) ?? styles.get('note') ?? FALLBACK;
}

/** Найденный знак коллаута. Смещения — от начала переданной строки. */
export interface CalloutMarker {
  /** Тип как написан в файле, в нижнем регистре. */
  type: string;
  /** Начало `[`. */
  from: number;
  /** Конец знака вместе со свёрткой `+`/`-` и одним пробелом за ним. */
  to: number;
}

/**
 * Разобрать первую строку цитаты.
 *
 * `null` — обычная цитата. Угловые скобки в начале допускаются любые:
 * коллаут бывает и вложенным.
 *
 * Знак свёртки `+`/`-` разбирается, но ничего не делает: свёртка коллаутов
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

  return { type, from, to: from + whole.length };
}
