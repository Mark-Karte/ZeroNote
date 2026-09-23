/**
 * Контраст по WCAG 2 — для проверки читаемости прямо в интерфейсе.
 *
 * Та же формула, что в тесте читаемости тем (`theme/mod.rs`, Р-078, Р-143),
 * и сверяется тестом по тем же опорным числам: чёрное на белом — 21:1.
 * Вторая копия формулы здесь нарочно: тест тем проверяет встроенные темы
 * при сборке, а своему цвету коллаута (задача 103) и своей теме (задача 105)
 * судья нужен в окне параметров, пока цвет подбирают.
 */

/** Разобрать `#rgb` или `#rrggbb`. Не цвет — `null`. */
export function parseHex(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(hex)) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as [number, number, number];
}

/** Относительная яркость: составляющие с весами, после гамма-коррекции. */
function luminance([r, g, b]: [number, number, number]): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Отношение контраста двух цветов `#rrggbb`. Не цвета — `null`. */
export function contrast(a: string, b: string): number | null {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) return null;
  const x = luminance(first);
  const y = luminance(second);
  const [light, dark] = x > y ? [x, y] : [y, x];
  return (light + 0.05) / (dark + 0.05);
}

/** Порог для текста: заголовок коллаута — текст. */
export const TEXT_CONTRAST = 4.5;
