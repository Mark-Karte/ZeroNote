import type { IconName } from './registry';

/**
 * Значок команды: одна таблица на всё приложение.
 *
 * Значок принадлежит **команде**, а не пункту меню (Р-148, продолжение
 * Р-107). Пункт меню, строка палитры и кнопка на панели показывают одно
 * действие, и показывать его тремя разными рисунками — значит трижды
 * рассказывать пользователю, что это разные вещи.
 *
 * Отсюда же следует, что таблица одна и лежит здесь, а не в компонентах:
 * добавили команду — добавили строку, и тест напомнит, если забыли.
 *
 * Один рисунок на несколько команд — норма: «Найти в проекте» и «Найти
 * в файле» обе про поиск. Разными рисунки делаются там, где различие
 * есть на деле: свернуть и развернуть, вперёд и назад.
 *
 * Пункты `menu.*` — те, что действуют на объект под курсором и команды
 * в реестре не имеют (Р-107), — лежат в той же таблице: для показа они
 * ничем не отличаются.
 */
const ICON_FOR: Record<string, IconName> = {
  // Файлы.
  'file.new': 'cmd.file-new',
  // Открытие файла идёт через системный диалог выбора — оттуда и папка.
  'file.open': 'tree.folder-open',
  'file.save': 'cmd.save',
  'file.save-as': 'cmd.save-as',
  'file.save-all': 'cmd.save-all',
  'file.close-tab': 'tab.close',
  'file.close-all': 'cmd.close-all',

  // Правка.
  'edit.undo': 'cmd.undo',
  'edit.redo': 'cmd.redo',
  'edit.cut': 'cmd.cut',
  'edit.copy': 'action.copy',
  'edit.paste': 'cmd.paste',
  'edit.select-all': 'cmd.select-all',
  'edit.select-line': 'cmd.select-line',
  'edit.undo-cursor': 'cmd.undo-cursor',
  'edit.redo-cursor': 'cmd.redo-cursor',
  'edit.toggle-comment': 'cmd.comment',
  'edit.duplicate-line': 'cmd.duplicate-line',
  'edit.add-cursor-next': 'cmd.add-cursor',
  'edit.toggle-wrap': 'cmd.wrap',
  'edit.delete-line': 'cmd.delete-line',
  'edit.move-line-up': 'cmd.move-line-up',
  'edit.move-line-down': 'cmd.move-line-down',
  'edit.upper-case': 'cmd.upper-case',
  'edit.lower-case': 'cmd.lower-case',

  // Поиск в файле.
  'search.find': 'panel.search',
  'search.replace': 'cmd.replace',
  'search.find-next': 'cmd.find-next',
  'search.find-previous': 'cmd.find-previous',

  // Вид.
  'view.bookmark': 'cmd.bookmark',
  'view.bookmark-next': 'cmd.bookmark-next',
  'view.bookmark-previous': 'cmd.bookmark-previous',
  'view.bookmarks-clear': 'cmd.bookmarks-clear',
  'view.invisibles': 'cmd.invisibles',
  'view.fold': 'cmd.fold',
  'view.unfold': 'cmd.unfold',
  'view.fold-all': 'cmd.fold-all',
  'view.unfold-all': 'cmd.unfold-all',
  'view.go-to-bracket': 'cmd.bracket',
  'view.go-to-line': 'cmd.go-to-line',
  'view.next-tab': 'cmd.next-tab',
  'view.previous-tab': 'cmd.previous-tab',
  'view.sidebar': 'cmd.sidebar',
  'view.settings': 'panel.settings',
  // Панели боковой полосы показываются своими значками: команда открывает
  // ровно ту панель, чей значок стоит в полосе, и второй рисунок для того
  // же места сбивал бы с толку.
  'view.outline': 'panel.outline',
  'view.tags': 'palette.tag',

  // Проект.
  'project.add-root': 'action.add-folder',
  'project.quick-open': 'cmd.quick-open',
  'project.commands': 'palette.command',
  'project.tags': 'palette.tag',
  'project.search': 'panel.search',
  'project.follow-link': 'cmd.follow-link',
  'project.backlinks': 'panel.links',

  // Справка.
  'help.about': 'cmd.about',
  'help.check-updates': 'cmd.update',

  // Разметка markdown: те же значки, что на панели над редактором.
  'md.bold': 'md.bold',
  'md.italic': 'md.italic',
  'md.strikethrough': 'md.strikethrough',
  'md.highlight': 'md.highlight',
  'md.code': 'md.code',
  'md.link': 'md.link',
  'md.heading-1': 'md.heading-1',
  'md.heading-2': 'md.heading-2',
  'md.heading-3': 'md.heading-3',
  'md.bullet-list': 'md.bullet-list',
  'md.ordered-list': 'md.ordered-list',
  'md.task-list': 'md.task-list',
  'md.quote': 'md.quote',
  'md.table': 'md.table',
  'md.code-block': 'md.code-block',
  'md.divider': 'md.divider',

  // Пункты, действующие на то, по чему щёлкнули.
  'menu.open': 'file.text',
  'menu.toggle': 'tree.chevron',
  'menu.refresh': 'cmd.refresh',
  'menu.copy-path': 'cmd.copy-path',
  'menu.copy-name': 'action.copy',
  'menu.reveal': 'tree.folder-open',
  'menu.close-others': 'cmd.close-others',
  'menu.new-file': 'cmd.file-new',
  'menu.new-folder': 'action.add-folder',
  'menu.rename': 'cmd.rename',
  'menu.delete': 'cmd.delete',
  'menu.project-file': 'action.project-file',
  'menu.obsidian': 'action.obsidian',
  'menu.remove-root': 'cmd.remove-folder',
};

/**
 * Значок команды или пункта меню. `null` — значка нет, и это не ошибка:
 * так помечены строки, которые командами не являются вовсе, — выбор
 * кодировки или языка в строке состояния.
 */
export function iconForCommand(id: string): IconName | null {
  return ICON_FOR[id] ?? null;
}

/** Для тестов: что вообще есть в таблице. */
export function commandsWithIcons(): string[] {
  return Object.keys(ICON_FOR);
}
