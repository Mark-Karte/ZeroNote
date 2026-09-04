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
 *
 * Единственное исключение — знак приложения: он двухцветный, и второй цвет
 * берёт токеном (Р-099). Оба требования и границы исключения проверяются
 * тестом `tests/icons.test.ts`.
 */

export type IconName =
  | 'app.mark'
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
  | 'action.check'
  | 'action.copy'
  | 'action.project-file'
  | 'action.obsidian'
  | 'tree.chevron'
  | 'tree.folder-open'
  | 'palette.command'
  | 'palette.tag'
  | 'panel.tree'
  | 'panel.search'
  | 'panel.links'
  | 'panel.outline'
  | 'panel.settings'
  | 'file.markdown'
  | 'file.text'
  | 'file.code'
  | 'md.bold'
  | 'md.italic'
  | 'md.strikethrough'
  | 'md.highlight'
  | 'md.code'
  | 'md.link'
  | 'md.bullet-list'
  | 'md.ordered-list'
  | 'md.task-list'
  | 'md.quote'
  | 'md.snippets';

const ICONS: Record<IconName, string> = {
  // Знак приложения: ноль со штрихом — «zero» и перо разом. Тот же рисунок,
  // что уходит в систему значком (`icons/`), с точностью до пропорций: кольцо
  // 11 к 14, толщина обводки — 0,19 высоты, штрих внутри просвета.
  //
  // Подложки нет: в системе она нужна, потому что там знак живёт плиткой,
  // а внутри окна фон наш и знак ложится прямо на него (Р-097).
  'app.mark':
    '<svg viewBox="0 0 16 16"><rect x="3.8" y="2.3" width="8.4" height="11.4" rx="4.2" fill="none" stroke="currentColor" stroke-width="2.6"/><rect x="7.25" y="3.95" width="1.5" height="8.1" rx="0.75" fill="var(--zn-color-accent)" transform="rotate(20 8 8)"/></svg>',

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
  // Галочка выбранного пункта меню. Значком, а не литерой «✓»: та берётся
  // из шрифта, а во вшитом Plex она другой ширины и уезжает от края.
  'action.check':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.4l3 3 6-6.8"/></svg>',
  // Два листа внахлёст — общепринятый знак копирования.
  'action.copy':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><rect x="5.6" y="5.6" width="8.4" height="8.4" rx="1.6"/><path d="M10.9 5.6V3.6A1.6 1.6 0 0 0 9.3 2H3.6A1.6 1.6 0 0 0 2 3.6v5.7a1.6 1.6 0 0 0 1.6 1.6h2"/></svg>',
  'action.project-file':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M9 1.6H4a1.4 1.4 0 0 0-1.4 1.4v10a1.4 1.4 0 0 0 1.4 1.4h8a1.4 1.4 0 0 0 1.4-1.4V6z"/><path d="M9 1.6V6h4.4"/><path d="M8 8.4v3.6M6.2 10.2h3.6" stroke-linecap="round"/></svg>',

  // Перенос настроек хранилища: стрелка внутрь, «взять к себе».
  // Логотип Obsidian не берём: чужой знак в своём интерфейсе намекает
  // на родство, которого нет (Р-022).
  'action.obsidian':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v7"/><path d="M5.2 6.4 8 9.2l2.8-2.8"/><path d="M3 11.2v1.3a1.2 1.2 0 0 0 1.2 1.2h7.6a1.2 1.2 0 0 0 1.2-1.2v-1.3"/></svg>',

  // Строки палитры: команда — уголок приглашения, тег — решётка.
  'palette.command':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5 7.2 8 4 11.5"/><path d="M8.6 11.6h3.6"/></svg>',
  'palette.tag':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6.1 2.6 4.8 13.4M11.2 2.6 9.9 13.4"/><path d="M2.9 5.9h10.6M2.5 10.1h10.6"/></svg>',

  // Полоса значков боковой панели (Р-044).
  'panel.tree':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h4l1 1.2h6"/><path d="M2.5 3.5v9h11v-7.8"/><path d="M5.5 7.2h5M5.5 9.8h3"/></svg>',
  'panel.search':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2l3.3 3.3"/></svg>',
  // Два звена цепи: обратные ссылки — это про связь между заметками.
  'panel.links':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1"/></svg>',

  // Оглавление: строки со ступенчатым отступом — то, как список выглядит
  // в самой панели. Список без отступа читался бы как обычный перечень
  // и не отличался бы от значка маркированного списка.
  'panel.outline':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 3.5h11"/><path d="M5 7h8.5"/><path d="M7.5 10.5h6"/><path d="M5 14h8.5"/></svg>',

  // Классическая шестерёнка — как в референсе, внизу полосы значков.
  'panel.settings':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M12.7 9.6a1 1 0 0 0 .2 1.1l.04.04a1.2 1.2 0 1 1-1.7 1.7l-.04-.04a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.92v.11a1.2 1.2 0 0 1-2.4 0v-.06a1 1 0 0 0-.66-.92 1 1 0 0 0-1.1.2l-.04.04a1.2 1.2 0 1 1-1.7-1.7l.04-.04a1 1 0 0 0 .2-1.1 1 1 0 0 0-.92-.6h-.11a1.2 1.2 0 0 1 0-2.4h.06a1 1 0 0 0 .92-.66 1 1 0 0 0-.2-1.1l-.04-.04a1.2 1.2 0 1 1 1.7-1.7l.04.04a1 1 0 0 0 1.1.2h.06a1 1 0 0 0 .6-.92v-.11a1.2 1.2 0 0 1 2.4 0v.06a1 1 0 0 0 .6.92 1 1 0 0 0 1.1-.2l.04-.04a1.2 1.2 0 1 1 1.7 1.7l-.04.04a1 1 0 0 0-.2 1.1v.06a1 1 0 0 0 .92.6h.11a1.2 1.2 0 0 1 0 2.4h-.06a1 1 0 0 0-.92.6z"/></svg>',

  // Уголок раскрытия. Одна форма на оба состояния: раскрытая папка получает
  // тот же значок повёрнутым, иначе два похожих значка пришлось бы держать
  // согласованными вручную.
  'tree.chevron':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4l4 4-4 4"/></svg>',
  'tree.folder-open':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M2 11.5V4.5A1.5 1.5 0 0 1 3.5 3h2.3c.4 0 .78.16 1.06.44L8 4.5h4.5A1.5 1.5 0 0 1 14 6v.5"/><path d="M2 11.5 3.7 7.6a1 1 0 0 1 .92-.6h9.4a.7.7 0 0 1 .64.98l-1.7 3.9a1 1 0 0 1-.92.62H3.5A1.5 1.5 0 0 1 2 11.5z"/></svg>',

  // Панель разметки markdown. Все — штриховые, одной толщины и без заливок:
  // рядом в строке стоят одиннадцать значков, и разнобой в весе виден сразу.
  'md.bold':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M4.8 2.8h3.6a2.5 2.5 0 0 1 0 5H4.8z"/><path d="M4.8 7.8h4.3a2.6 2.6 0 0 1 0 5.2H4.8z"/></svg>',
  'md.italic':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6.6 3h4.8M4.6 13h4.8M10 3 6.4 13"/></svg>',
  // Буква S, перечёркнутая посередине. Толщина та же, что у прочих.
  'md.strikethrough':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.6 8h10.8"/><path d="M11.3 4.9C10.7 3.7 9.5 3 8 3 6.2 3 5 3.9 5 5.2c0 1 .7 1.7 2 2.2"/><path d="M4.9 11.1c.6 1.2 1.8 1.9 3.3 1.9 1.9 0 3-.9 3-2.2 0-.5-.2-.9-.5-1.3"/></svg>',
  // Буква A на подложке — знак маркера, каким его рисуют текстовые редакторы.
  'md.highlight':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13.4h10"/><path d="M5.2 10.4 8 2.9l2.8 7.5"/><path d="M6.2 7.8h3.6"/></svg>',
  'md.code':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 4.2 2.4 8l3.4 3.8"/><path d="M10.2 4.2 13.6 8l-3.4 3.8"/></svg>',
  'md.link':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6.9 9.1a2.7 2.7 0 0 0 3.8 0l2-2a2.7 2.7 0 1 0-3.8-3.8l-.8.8"/><path d="M9.1 6.9a2.7 2.7 0 0 0-3.8 0l-2 2a2.7 2.7 0 1 0 3.8 3.8l.8-.8"/></svg>',
  // Точки нарисованы отрезком нулевой длины с круглым концом: так у списка
  // не появляется заливки, а значит, и своего цвета.
  'md.bullet-list':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 4h.01M3 8h.01M3 12h.01"/><path d="M6.4 4h7.2M6.4 8h7.2M6.4 12h7.2"/></svg>',
  'md.ordered-list':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 4h7M6.6 8h7M6.6 12h7"/><path d="M1.9 3.1 3 2.4V6"/><path d="M1.9 10.2a1.2 1.2 0 0 1 2.3.4c0 .9-2.3 1.4-2.3 2.6h2.4"/></svg>',
  // Один флажок, а не два: при шестнадцати пикселях две галочки со строками
  // сливаются в кашу — проверено на живом окне.
  'md.task-list':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.9" y="4" width="6.2" height="6.2" rx="1.5"/><path d="M3.4 7.1 4.6 8.3 6.6 5.7"/><path d="M10.4 6h3.7M10.4 9.2h3.7"/></svg>',
  'md.quote':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.8 3.4v9.2"/><path d="M6.4 5h7.2M6.4 8h7.2M6.4 11h4.4"/></svg>',
  // Заготовка — это вставка готового блока, отсюда плюс внутри рамки.
  'md.snippets':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2"/><path d="M8 5.4v5.2M5.4 8h5.2"/></svg>',

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
