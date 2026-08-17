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
  | 'status.warning'
  | 'window.minimize'
  | 'window.maximize'
  | 'window.restore'
  | 'window.close'
  | 'tab.close'
  | 'tab.modified'
  | 'action.add-folder'
  | 'action.remove'
  | 'action.project-file'
  | 'tree.chevron'
  | 'tree.folder-open'
  | 'file.markdown'
  | 'file.text'
  | 'file.code';

const ICONS: Record<IconName, string> = {
  // Кнопки окна. Формы взяты из системного набора Windows 11, чтобы
  // собственный заголовок не выглядел чужеродно.
  'window.minimize':
    '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><path d="M0 5.5h10"/></svg>',
  'window.maximize':
    '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x="0.5" y="0.5" width="9" height="9" rx="1"/></svg>',
  'window.restore':
    '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x="0.5" y="2.5" width="7" height="7" rx="1"/><path d="M2.5 2.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1"/></svg>',
  'window.close':
    '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/></svg>',

  'tab.close':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  // Точка вместо крестика на изменённой вкладке — как в VS Code.
  'tab.modified':
    '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3.6"/></svg>',

  // Действия боковой панели.
  'action.add-folder':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M14 8.5V6a1.5 1.5 0 0 0-1.5-1.5H8L6.86 3.44A1.5 1.5 0 0 0 5.8 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13H8"/><path d="M11.5 9.5v4M9.5 11.5h4" stroke-linecap="round"/></svg>',
  'action.remove':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  'action.project-file':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M9 1.6H4a1.4 1.4 0 0 0-1.4 1.4v10a1.4 1.4 0 0 0 1.4 1.4h8a1.4 1.4 0 0 0 1.4-1.4V6z"/><path d="M9 1.6V6h4.4"/><path d="M8 8.4v3.6M6.2 10.2h3.6" stroke-linecap="round"/></svg>',

  // Уголок раскрытия. Одна форма на оба состояния: раскрытая папка получает
  // тот же значок повёрнутым, иначе два похожих значка пришлось бы держать
  // согласованными вручную.
  'tree.chevron':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4l4 4-4 4"/></svg>',
  'tree.folder-open':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M2 11.5V4.5A1.5 1.5 0 0 1 3.5 3h2.3c.4 0 .78.16 1.06.44L8 4.5h4.5A1.5 1.5 0 0 1 14 6v.5"/><path d="M2 11.5 3.7 7.6a1 1 0 0 1 .92-.6h9.4a.7.7 0 0 1 .64.98l-1.7 3.9a1 1 0 0 1-.92.62H3.5A1.5 1.5 0 0 1 2 11.5z"/></svg>',

  'file.markdown':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M9 1.6H4a1.4 1.4 0 0 0-1.4 1.4v10a1.4 1.4 0 0 0 1.4 1.4h8a1.4 1.4 0 0 0 1.4-1.4V6z"/><path d="M9 1.6V6h4.4"/><path d="M5.2 11.6V8.4l1.5 1.8 1.5-1.8v3.2" stroke-linecap="round"/></svg>',
  'file.text':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M9 1.6H4a1.4 1.4 0 0 0-1.4 1.4v10a1.4 1.4 0 0 0 1.4 1.4h8a1.4 1.4 0 0 0 1.4-1.4V6z"/><path d="M9 1.6V6h4.4"/><path d="M5.4 9h5.2M5.4 11.4h3.4" stroke-linecap="round"/></svg>',
  'file.code':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M9 1.6H4a1.4 1.4 0 0 0-1.4 1.4v10a1.4 1.4 0 0 0 1.4 1.4h8a1.4 1.4 0 0 0 1.4-1.4V6z"/><path d="M9 1.6V6h4.4"/><path d="M6.4 8.8L5 10.2l1.4 1.4M9.6 8.8L11 10.2l-1.4 1.4" stroke-linecap="round"/></svg>',

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
