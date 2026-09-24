/**
 * Шрифты во вкладке «Оформление» (задача 105).
 *
 * Шрифт — настройка человека, тема — умолчание (решение владельца).
 * В токене лежит список CSS, и на экране первый из него, что нашёлся.
 * Какой именно — вопрос, на который вебвью не отвечает: перечислить
 * установленные шрифты он не даёт. Отвечает измерение (`ui/font-check.ts`),
 * а здесь — разбор списка и выбор первого доступного, чистыми функциями.
 */

/** Общие семейства: есть всегда, это не шрифты, а просьба «какой-нибудь». */
export const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
]);

/** Вшитые в приложение (`fonts.css`): есть на любой машине. */
export const BUNDLED = new Set(['IBM Plex Sans', 'JetBrains Mono']);

/**
 * Подсказки в поле ввода: вшитые и те, что стоят в Windows 10/11 из коробки.
 * Набрать можно любой — подсказка лишь избавляет от опечатки в имени.
 */
export const UI_SUGGESTIONS = [
  'IBM Plex Sans',
  'Segoe UI Variable Text',
  'Segoe UI',
  'Arial',
  'Calibri',
  'Verdana',
  'Tahoma',
];

export const EDITOR_SUGGESTIONS = [
  'JetBrains Mono',
  'Cascadia Code',
  'Cascadia Mono',
  'Consolas',
  'Courier New',
  'Lucida Console',
];

/** Список CSS в имена: `'IBM Plex Sans', system-ui` → `IBM Plex Sans`, `system-ui`. */
export function splitFamilies(css: string): string[] {
  return css
    .split(',')
    .map((part) => part.trim().replace(/^(['"])(.*)\1$/, '$2').trim())
    .filter((name) => name !== '');
}

/** Откуда шрифт на экране — для подписи под полем. */
export type FontSource = 'bundled' | 'system' | 'generic';

export interface ShownFont {
  name: string;
  source: FontSource;
}

/**
 * Первый шрифт списка, который есть. `installed` — вопрос к системе;
 * вшитые и общие семейства есть всегда и её не спрашивают.
 */
export function firstAvailable(
  families: string[],
  installed: (name: string) => boolean,
): ShownFont | null {
  for (const name of families) {
    if (BUNDLED.has(name)) return { name, source: 'bundled' };
    if (GENERIC.has(name.toLowerCase())) return { name, source: 'generic' };
    if (installed(name)) return { name, source: 'system' };
  }
  return null;
}

/** Размер из токена: `14px` → 14. Не пиксели — `null`. */
export function pixels(value: string | undefined): number | null {
  const match = /^([\d.]+)px$/.exec(value?.trim() ?? '');
  return match ? Number(match[1]) : null;
}
