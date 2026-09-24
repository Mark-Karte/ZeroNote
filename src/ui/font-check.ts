/**
 * Есть ли шрифт в системе (задача 105).
 *
 * Перечислить установленные шрифты вебвью не даёт, а `document.fonts.check`
 * про системные шрифты отвечает «да» всегда — ему нечего загружать. Отвечает
 * измерение: строка набирается запрошенным шрифтом с запасным и одним
 * запасным. Ширина совпала для всех запасных — запрошенного нет, на экране
 * запасной. Запасных три, потому что шрифт может совпасть по ширине с одним
 * из них: Consolas — это и есть `monospace` в Windows.
 */

const PROBE = 'mmmmmmmmmmlli1WQ@#ЖжщЫ';
const SIZE = '72px';
const FALLBACKS = ['monospace', 'serif', 'sans-serif'];

let context: CanvasRenderingContext2D | null | undefined;
const known = new Map<string, boolean>();

export function installed(family: string): boolean {
  const cached = known.get(family);
  if (cached !== undefined) return cached;

  context ??= document.createElement('canvas').getContext('2d');
  // Мерить нечем — не утверждаем, что шрифта нет: ложная тревога хуже
  // молчания там, где проверить нельзя.
  if (!context) return true;

  const name = `"${family.replace(/["\\]/g, '')}"`;
  const ctx = context;
  const found = FALLBACKS.some((fallback) => {
    ctx.font = `${SIZE} ${fallback}`;
    const alone = ctx.measureText(PROBE).width;
    ctx.font = `${SIZE} ${name}, ${fallback}`;
    return ctx.measureText(PROBE).width !== alone;
  });

  known.set(family, found);
  return found;
}
