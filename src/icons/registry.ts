/**
 * Реестр иконок.
 *
 * Иконки подключаются по логическому имени (`status.folder`, `action.save`),
 * а не вставляются в разметку. Смена набора иконок — правка одного этого файла,
 * ни один компонент при этом не меняется.
 *
 * Требования к иконке:
 * * `viewBox` есть, `width`/`height` нет — размер задаёт токен;
 * * цвет только `currentColor` — иначе иконка не переживёт смену темы.
 * Оба требования проверяются тестом `tests/icons.test.ts`.
 */

export type IconName =
  | 'status.folder'
  | 'status.folder-alert'
  | 'status.theme-light'
  | 'status.theme-dark'
  | 'status.warning';

const ICONS: Record<IconName, string> = {
  'status.folder':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.3c.4 0 .78.16 1.06.44L8 4.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/></svg>',

  'status.folder-alert':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.3c.4 0 .78.16 1.06.44L8 4.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/><path d="M8 7v2.5" stroke-linecap="round"/><path d="M8 11.4v.1" stroke-linecap="round"/></svg>',

  'status.theme-light':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.2M8 13.3v1.2M14.5 8h-1.2M2.7 8H1.5M12.6 3.4l-.85.85M4.25 11.75l-.85.85M12.6 12.6l-.85-.85M4.25 4.25l-.85-.85"/></svg>',

  'status.theme-dark':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z"/></svg>',

  'status.warning':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M8 2.4 14.4 13H1.6z"/><path d="M8 6.6v2.8" stroke-linecap="round"/><path d="M8 11.3v.1" stroke-linecap="round"/></svg>',
};

/**
 * Разметка иконки по логическому имени.
 *
 * Неизвестное имя — это ошибка программиста, и она должна быть громкой:
 * молча отрисованная пустота отлаживается втрое дольше.
 */
export function icon(name: IconName): string {
  const markup = ICONS[name];
  if (!markup) {
    throw new Error(`иконка не зарегистрирована: ${name}`);
  }
  return markup;
}

/** Для тестов и для будущего окна параметров. */
export function iconNames(): IconName[] {
  return Object.keys(ICONS) as IconName[];
}
