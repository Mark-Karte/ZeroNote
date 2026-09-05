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
  | 'md.snippets'
  | 'cmd.file-new'
  | 'cmd.save'
  | 'cmd.save-as'
  | 'cmd.save-all'
  | 'cmd.close-all'
  | 'cmd.close-others'
  | 'cmd.undo'
  | 'cmd.redo'
  | 'cmd.cut'
  | 'cmd.paste'
  | 'cmd.select-all'
  | 'cmd.select-line'
  | 'cmd.delete-line'
  | 'cmd.duplicate-line'
  | 'cmd.move-line-up'
  | 'cmd.move-line-down'
  | 'cmd.comment'
  | 'cmd.upper-case'
  | 'cmd.lower-case'
  | 'cmd.add-cursor'
  | 'cmd.undo-cursor'
  | 'cmd.redo-cursor'
  | 'cmd.wrap'
  | 'cmd.find-next'
  | 'cmd.find-previous'
  | 'cmd.replace'
  | 'cmd.bookmark'
  | 'cmd.bookmark-next'
  | 'cmd.bookmark-previous'
  | 'cmd.bookmarks-clear'
  | 'cmd.fold'
  | 'cmd.unfold'
  | 'cmd.fold-all'
  | 'cmd.unfold-all'
  | 'cmd.bracket'
  | 'cmd.go-to-line'
  | 'cmd.invisibles'
  | 'cmd.next-tab'
  | 'cmd.previous-tab'
  | 'cmd.sidebar'
  | 'cmd.follow-link'
  | 'cmd.quick-open'
  | 'cmd.about'
  | 'cmd.update'
  | 'cmd.refresh'
  | 'cmd.copy-path'
  | 'cmd.rename'
  | 'cmd.delete'
  | 'cmd.remove-folder'
  | 'md.heading-1'
  | 'md.heading-2'
  | 'md.heading-3'
  | 'md.table'
  | 'md.code-block'
  | 'md.divider';

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

  // Значки команд (задача 55). Таблица «команда → значок» лежит
  // в icons/commands.ts; здесь только рисунки.
  // Лист с плюсом — тот же лист, что у значков видов файлов.
  'cmd.file-new':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M9 1.6H4a1.4 1.4 0 0 0-1.4 1.4v10a1.4 1.4 0 0 0 1.4 1.4h8a1.4 1.4 0 0 0 1.4-1.4V6z"/><path d="M9 1.6V6h4.4"/><path d="M8 8.4v3.6M6.2 10.2h3.6" stroke-linecap="round"/></svg>',
  // Дискета: знак сохранения пережил саму дискету.
  'cmd.save':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M2.8 3.6A1.4 1.4 0 0 1 4.2 2.2h6.2L13.2 5v7.4a1.4 1.4 0 0 1-1.4 1.4H4.2a1.4 1.4 0 0 1-1.4-1.4z"/><path d="M5.4 13.6V9.4h5.2v4.2"/><path d="M5.4 2.2v3.2h3.4V2.2"/></svg>',
  // Та же дискета с пером: сохранить под другим именем.
  'cmd.save-as':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M2.8 3.6A1.4 1.4 0 0 1 4.2 2.2h6.2L13.2 5v3.2"/><path d="M2.8 3.6v8.8a1.4 1.4 0 0 0 1.4 1.4h3.4"/><path d="M5.4 2.2v3.2h3.4V2.2"/><path d="M13.9 10.2 11 13.1l-1.6.4.4-1.6 2.9-2.9a.75.75 0 0 1 1.2 1.2z"/></svg>',
  // Две дискеты внахлёст — как два листа у копирования.
  'cmd.save-all':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M11.2 3.4V3A1.4 1.4 0 0 0 9.8 1.6H3.4A1.4 1.4 0 0 0 2 3v6.4a1.4 1.4 0 0 0 1.4 1.4h.8"/><path d="M5.6 5.8a1.2 1.2 0 0 1 1.2-1.2h4.4L14 7.2v5.2a1.2 1.2 0 0 1-1.2 1.2H6.8a1.2 1.2 0 0 1-1.2-1.2z"/><path d="M7.8 13.6v-3.2h3.6v3.2"/></svg>',
  // Стопка вкладок с крестом.
  'cmd.close-all':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M4.6 11.6H3.4A1.4 1.4 0 0 1 2 10.2V3.4A1.4 1.4 0 0 1 3.4 2h6.8a1.4 1.4 0 0 1 1.4 1.4v1.2"/><rect x="4.6" y="4.6" width="9.4" height="9.4" rx="1.4"/><path d="M7.2 7.2l4.2 4.2M11.4 7.2l-4.2 4.2" stroke-linecap="round"/></svg>',
  // Одна вкладка остаётся, остальные закрываются.
  'cmd.close-others':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2.2" y="4.2" width="5" height="7.6" rx="1.2"/><path d="M9.6 6l4 4M13.6 6l-4 4" stroke-linecap="round"/></svg>',
  // Стрелка назад с загибом — общепринятый знак отмены.
  'cmd.undo':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 3.9 3.4 7.1l3.2 3.2"/><path d="M3.4 7.1h6.1a3.4 3.4 0 0 1 0 6.8H6.2"/></svg>',
  'cmd.redo':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 3.9l3.2 3.2-3.2 3.2"/><path d="M12.6 7.1H6.5a3.4 3.4 0 0 0 0 6.8h3.3"/></svg>',
  // Ножницы.
  'cmd.cut':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.6" cy="11.9" r="1.8"/><circle cx="11.4" cy="11.9" r="1.8"/><path d="M5.9 10.6 11.6 2.6M10.1 10.6 4.4 2.6"/></svg>',
  // Планшет с зажимом.
  'cmd.paste':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M6 3.2H4.6A1.4 1.4 0 0 0 3.2 4.6v8.2a1.4 1.4 0 0 0 1.4 1.4h6.8a1.4 1.4 0 0 0 1.4-1.4V4.6a1.4 1.4 0 0 0-1.4-1.4H10"/><rect x="6" y="1.8" width="4" height="2.8" rx="0.9"/></svg>',
  // Уголки рамки вокруг текста — знак выделения всего.
  'cmd.select-all':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 5.4V3.6a1 1 0 0 1 1-1h1.8M10.6 2.6h1.8a1 1 0 0 1 1 1v1.8M13.4 10.6v1.8a1 1 0 0 1-1 1h-1.8M5.4 13.4H3.6a1 1 0 0 1-1-1v-1.8"/><path d="M5.4 6.6h5.2M5.4 9.4h3"/></svg>',
  // Одна строка обведена рамкой, соседние — нет.
  'cmd.select-line':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2.4" y="6.4" width="11.2" height="3.2" rx="1"/><path d="M4 3.4h8M4 12.6h8"/></svg>',
  // Строка с крестом.
  'cmd.delete-line':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2.4 4.2h11.2M2.4 11.8h11.2M2.4 8h5"/><path d="M9.4 6.2l4 3.6M13.4 6.2l-4 3.6"/></svg>',
  // Две одинаковые строки и плюс.
  'cmd.duplicate-line':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2.6 3.6h10.8M2.6 6.8h10.8"/><path d="M2.6 11.6h6.2"/><path d="M11.6 9.8v3.6M9.8 11.6h3.6"/></svg>',
  // Строки и стрелка сбоку: вверх и вниз.
  'cmd.move-line-up':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.8 4.2h6.6M6.8 8h6.6M6.8 11.8h6.6"/><path d="M3.4 12.4V4.2M1.8 5.8 3.4 4.2 5 5.8"/></svg>',
  'cmd.move-line-down':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.8 4.2h6.6M6.8 8h6.6M6.8 11.8h6.6"/><path d="M3.4 3.6v8.2M1.8 10.2 3.4 11.8 5 10.2"/></svg>',
  // Выноска. Двойной слэш был бы точнее для кода, но в палитре он встал бы
  // рядом с решёткой тега, а два коротких штриха от неё не отличить.
  'cmd.comment':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M13.4 9.4a1.6 1.6 0 0 1-1.6 1.6H5.4l-2.8 2.6V4.4a1.6 1.6 0 0 1 1.6-1.6h7.6a1.6 1.6 0 0 1 1.6 1.6z"/></svg>',
  // Прописная A со стрелкой вверх, строчная a со стрелкой вниз.
  'cmd.upper-case':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 12.4 6 3.8l3.4 8.6"/><path d="M3.9 9.6h4.2"/><path d="M12.6 12.4V5.2M11 6.8l1.6-1.6 1.6 1.6"/></svg>',
  'cmd.lower-case':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.2" cy="9.8" r="2.6"/><path d="M7.8 7.2v5.2"/><path d="M12.6 3.6v7.2M11 9.2l1.6 1.6 1.6-1.6"/></svg>',
  // Курсор в тексте и плюс: ещё один курсор.
  'cmd.add-cursor':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4.2 3.4h3.4M4.2 12.6h3.4M5.9 3.4v9.2"/><path d="M11.6 6.4v4M9.6 8.4h4"/></svg>',
  // Стрелка отмены и курсор: отменяется не текст, а положение курсора.
  'cmd.undo-cursor':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.8 3.2 2.6 5.4l2.2 2.2"/><path d="M2.6 5.4h4.6a2.6 2.6 0 0 1 2.6 2.6v.8"/><path d="M10 10.6h3.4M10 14h3.4M11.7 10.6V14"/></svg>',
  'cmd.redo-cursor':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11.2 3.2l2.2 2.2-2.2 2.2"/><path d="M13.4 5.4H8.8a2.6 2.6 0 0 0-2.6 2.6v.8"/><path d="M2.6 10.6H6M2.6 14H6M4.3 10.6V14"/></svg>',
  // Строка, загибающаяся на следующую.
  'cmd.wrap':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 3.8h10.8"/><path d="M2.6 7.6h8.2a2.4 2.4 0 0 1 0 4.8H6.4"/><path d="M8 10.6 6.2 12.4 8 14.2"/><path d="M2.6 12.4h1.6"/></svg>',
  // Лупа и стрелка: следующее совпадение и предыдущее.
  'cmd.find-next':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="6.6" cy="6.6" r="3.8"/><path d="M9.4 9.4 11 11"/><path d="M10.4 11.4 12.4 13.4l1.8-1.8"/></svg>',
  'cmd.find-previous':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="6.6" cy="6.6" r="3.8"/><path d="M9.4 9.4 11 11"/><path d="M10.4 13.4 12.4 11.4l1.8 1.8"/></svg>',
  // Две встречные стрелки: одно меняется на другое.
  'cmd.replace':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.8 5.6h8.4M9.2 3.4l2.2 2.2-2.2 2.2"/><path d="M13.2 10.4H4.8M6.8 8.2 4.6 10.4l2.2 2.2"/></svg>',
  // Ленточка закладки. Она же пойдёт в панель закладок задачи 59.
  'cmd.bookmark':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M4.4 2.8h7.2v10.6L8 10.8l-3.6 2.6z"/></svg>',
  'cmd.bookmark-next':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 2.6h6v10.2L6.2 10.4l-3 2.4z"/><path d="M12.4 7.8v5.4M10.9 11.7l1.5 1.5 1.5-1.5"/></svg>',
  'cmd.bookmark-previous':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 2.6h6v10.2L6.2 10.4l-3 2.4z"/><path d="M12.4 13.2V7.8M10.9 9.3l1.5-1.5 1.5 1.5"/></svg>',
  'cmd.bookmarks-clear':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 2.6h6v10.2L6.2 10.4l-3 2.4z"/><path d="M10.6 8.6l3.2 3.2M13.8 8.6l-3.2 3.2"/></svg>',
  // Стрелка к строке — свернуть, от строки — развернуть; у «всех» стрелка
  // двойная. Первый рисунок был из голых уголков без древка: в живом меню
  // при шестнадцати пикселях они слипались в звёздочку. Родня значка списка
  // задач из задачи 43 — узнаваемость рисунка тестом не проверить.
  'cmd.fold':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 8h10.8"/><path d="M8 2.4v3.4M6.4 4.2 8 5.8l1.6-1.6"/><path d="M8 13.6v-3.4M6.4 11.8 8 10.2l1.6 1.6"/></svg>',
  'cmd.unfold':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 8h10.8"/><path d="M8 5.8V2.4M6.4 4 8 2.4l1.6 1.6"/><path d="M8 10.2v3.4M6.4 12 8 13.6l1.6-1.6"/></svg>',
  'cmd.fold-all':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 8h10.8"/><path d="M6.4 2.2 8 3.8l1.6-1.6M6.4 4.8 8 6.4l1.6-1.6"/><path d="M6.4 13.8 8 12.2l1.6 1.6M6.4 11.2 8 9.6l1.6 1.6"/></svg>',
  'cmd.unfold-all':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 8h10.8"/><path d="M6.4 4 8 2.4l1.6 1.6M6.4 6.6 8 5l1.6 1.6"/><path d="M6.4 12 8 13.6l1.6-1.6M6.4 9.4 8 11l1.6-1.6"/></svg>',
  // Пара фигурных скобок: переход к парной.
  'cmd.bracket':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 2.8c-1.4 0-1.9.6-1.9 1.9v1.6c0 1-.4 1.5-1.5 1.7 1.1.2 1.5.7 1.5 1.7v1.6c0 1.3.5 1.9 1.9 1.9"/><path d="M9.6 2.8c1.4 0 1.9.6 1.9 1.9v1.6c0 1 .4 1.5 1.5 1.7-1.1.2-1.5.7-1.5 1.7v1.6c0 1.3-.5 1.9-1.9 1.9"/></svg>',
  // Стрелка, указывающая на строку.
  'cmd.go-to-line':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.8 4h6.6M6.8 8h6.6M6.8 12h6.6"/><path d="M2.4 8h2.4M3.6 6.4 5.2 8 3.6 9.6"/></svg>',
  // Знак абзаца — им же помечается перенос строки в тексте.
  'cmd.invisibles':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11.8 3.2H7.9a2.9 2.9 0 0 0 0 5.8h1.4"/><path d="M9.3 3.2v9.6M11.8 3.2v9.6"/></svg>',
  // Уголок и край окна: следующая вкладка и предыдущая.
  'cmd.next-tab':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M5.4 3.4 10 8l-4.6 4.6"/><path d="M12.6 3.4v9.2"/></svg>',
  'cmd.previous-tab':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 3.4 6 8l4.6 4.6"/><path d="M3.4 3.4v9.2"/></svg>',
  // Окно с колонкой слева — то, что и включается.
  'cmd.sidebar':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.6"/><path d="M6.6 3.4v9.2"/></svg>',
  // Стрелка, выходящая из рамки: перейти по ссылке.
  'cmd.follow-link':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12.4 9.2V12a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 12V5.8a1.6 1.6 0 0 1 1.6-1.6h2.8"/><path d="M10 2.8h3.4v3.4"/><path d="M13.4 2.8 8.4 7.8"/></svg>',
  // Лист под лупой: найти файл по имени.
  'cmd.quick-open':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M8.4 2.2H4.6a1.4 1.4 0 0 0-1.4 1.4v8.8a1.4 1.4 0 0 0 1.4 1.4h2"/><path d="M8.4 2.2v3.4h3.4"/><circle cx="10.6" cy="10.2" r="2.6"/><path d="M12.5 12.1 14 13.6" stroke-linecap="round"/></svg>',
  // Буква i в круге.
  'cmd.about':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.6"/><path d="M8 7.4v3.4"/><path d="M8 5.1v.1"/></svg>',
  // Стрелка вниз к черте — загрузка. У переноса настроек Obsidian стрелка та
  // же, но в лоток: там берут чужое к себе, здесь кладут новое поверх своего.
  'cmd.update':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.6v7"/><path d="M5.2 6.8 8 9.6l2.8-2.8"/><path d="M2.8 12.6h10.4"/></svg>',
  // Круговая стрелка.
  'cmd.refresh':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 8a5.2 5.2 0 1 1-1.7-3.8"/><path d="M13.4 2.6v3.4H10"/></svg>',
  // Два уголка, как в крошках над рабочей областью: путь.
  'cmd.copy-path':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M3.6 4.4 7 8l-3.4 3.6"/><path d="M8.6 4.4 12 8l-3.4 3.6"/></svg>',
  // Перо.
  'cmd.rename':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11.4 2.8a1.7 1.7 0 0 1 2.4 2.4l-7.6 7.6-3.2.8.8-3.2z"/><path d="M10.2 4l2.4 2.4"/></svg>',
  // Корзина: мимо неё мы не удаляем никогда (Р-110).
  'cmd.delete':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.8 4.6h10.4"/><path d="M6.2 4.6V3.4a1 1 0 0 1 1-1h1.6a1 1 0 0 1 1 1v1.2"/><path d="M4.4 4.6v7.8a1.4 1.4 0 0 0 1.4 1.4h4.4a1.4 1.4 0 0 0 1.4-1.4V4.6"/><path d="M6.8 7.4v3.4M9.2 7.4v3.4"/></svg>',
  // Та же папка, что у «добавить», но с минусом.
  'cmd.remove-folder':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"><path d="M14 8.5V6a1.5 1.5 0 0 0-1.5-1.5H8L6.86 3.44A1.5 1.5 0 0 0 5.8 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13H8"/><path d="M9.5 11.5h4" stroke-linecap="round"/></svg>',
  // Буква H с цифрой уровня.
  'md.heading-1':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 3.4v9.2M8 3.4v9.2M2.6 8H8"/><path d="M10.8 9.6 12.4 8.6v4.6"/></svg>',
  'md.heading-2':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 3.4v9.2M8 3.4v9.2M2.6 8H8"/><path d="M10.6 9.6a1.5 1.5 0 0 1 2.9.6c0 1.2-2.9 1.8-2.9 3h3"/></svg>',
  'md.heading-3':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 3.4v9.2M8 3.4v9.2M2.6 8H8"/><path d="M10.7 9a1.4 1.4 0 1 1 1.1 2.2 1.4 1.4 0 1 1-1.1 2.2"/></svg>',
  // Сетка.
  'md.table':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.4"/><path d="M2.4 6.6h11.2M2.4 9.6h11.2M6.6 6.6v6"/></svg>',
  // Уголки кода в рамке: тот же знак, что у строчного кода, но блоком.
  'md.code-block':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.6"/><path d="M6.4 6.6 4.9 8l1.5 1.4M9.6 6.6 11.1 8l-1.5 1.4"/></svg>',
  // Черта между строками — и толще их.
  'md.divider':
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M3.4 4h9.2M3.4 12h9.2" stroke-width="1.3"/><path d="M2.4 8h11.2" stroke-width="2"/></svg>',

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
