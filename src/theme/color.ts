/**
 * Цвет из файла темы — в числа и обратно (задача 105).
 *
 * Палитра пишет цвета двумя способами: `#rrggbb` и `rgba(r, g, b, a)`
 * для полупрозрачных — подсветки строки, выделения, теней, подложки.
 * Системный выбор цвета (`input type=color`) умеет только первый, поэтому
 * прозрачность правится отдельным ползунком, а цвет собирается обратно
 * здесь: непрозрачный — шестнадцатеричным, как его пишут в темах,
 * полупрозрачный — `rgba`, как во встроенных темах.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** От 0 до 1. */
  a: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/** Разобрать цвет. Не цвет (ссылка на палитру, имя, тень) — `null`. */
export function parseColor(value: string): Rgba | null {
  const text = value.trim();

  const hex = HEX.exec(text);
  if (hex) {
    let digits = hex[1] as string;
    if (digits.length === 3) digits = [...digits].map((c) => c + c).join('');
    const channel = (at: number): number => parseInt(digits.slice(at, at + 2), 16);
    return {
      r: channel(0),
      g: channel(2),
      b: channel(4),
      a: digits.length === 8 ? Math.round((channel(6) / 255) * 100) / 100 : 1,
    };
  }

  const fn = FUNCTION.exec(text);
  if (fn) {
    const [r, g, b] = [fn[1], fn[2], fn[3]].map(Number) as [number, number, number];
    const a = fn[4] === undefined ? 1 : Number(fn[4]);
    if ([r, g, b].some((c) => c > 255) || a > 1) return null;
    return { r, g, b, a };
  }

  return null;
}

/** `#rrggbb` без прозрачности — то, что понимает `input type=color`. */
export function toHex({ r, g, b }: Rgba): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

/**
 * Записать цвет так, как его пишут в темах: непрозрачный — `#rrggbb`,
 * полупрозрачный — `rgba(r, g, b, a)` с плотностью до сотых.
 */
export function formatColor(color: Rgba): string {
  const alpha = Math.round(Math.min(1, Math.max(0, color.a)) * 100) / 100;
  if (alpha >= 1) return toHex(color);
  const [r, g, b] = [color.r, color.g, color.b].map(Math.round);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
