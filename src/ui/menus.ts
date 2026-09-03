import type { PopupItem } from './popup-item';

/**
 * Из чего состоят контекстные меню.
 *
 * Чистые функции без единого обращения к DOM и к состоянию приложения:
 * набор пунктов — это то, что должно проверяться тестом, а не глазами
 * по одному щелчку за раз.
 *
 * Главное правило — Р-107: пункт не заводит своё действие, а ссылается
 * на команду из реестра и оттуда же берёт подпись и сочетание. Поэтому
 * названия команд здесь не написаны: они приходят списком `commands`.
 *
 * Исключение — пункты, действующие на то, по чему щёлкнули: «копировать
 * путь», «закрыть другие». У них нет и не может быть сочетания клавиш,
 * потому что у клавиши нет объекта под курсором (Р-108).
 */

/** Команда реестра: то, что отдаёт `keymap/global.svelte`. */
export interface Command {
  id: string;
  title: string;
  binding: string | null;
}

/** Пункты, живущие только в меню. Отдельным набором, чтобы не спутать с командами. */
export const MENU = {
  open: 'menu.open',
  toggle: 'menu.toggle',
  refresh: 'menu.refresh',
  copyPath: 'menu.copy-path',
  copyName: 'menu.copy-name',
  reveal: 'menu.reveal',
  closeOthers: 'menu.close-others',
  projectFile: 'menu.project-file',
  obsidian: 'menu.obsidian',
  removeRoot: 'menu.remove-root',
} as const;

/**
 * Пункт по команде из реестра.
 *
 * Команды нет в списке — нет и пункта. Это не молчаливое проглатывание
 * ошибки: список приходит из ядра, и команда может отсутствовать только
 * если реестр не собрался. Пункт, который ничего не делает, в таком случае
 * хуже отсутствующего.
 */
function fromCommand(
  commands: Command[],
  id: string,
  extra: Partial<PopupItem> = {},
): PopupItem | null {
  const command = commands.find((item) => item.id === id);
  if (!command) return null;
  return { id, label: command.title, key: command.binding ?? undefined, ...extra };
}

/**
 * Убрать пропавшие пункты и черту, оказавшуюся первой строкой меню.
 *
 * Черта принадлежит пункту, а не стоит отдельной записью, — поэтому исчезнуть
 * она может только вместе с ним, и две подряд получиться не могут. А вот
 * первой остаться может: пропала вся предыдущая группа. Тогда это не
 * разделение, а рамка внутри рамки.
 */
function tidy(items: (PopupItem | null)[]): PopupItem[] {
  const out: PopupItem[] = [];
  for (const item of items) {
    if (!item) continue;
    // Черта в начале меню и две черты подряд — след от скрытого пункта.
    if (item.divider && out.length === 0) {
      out.push({ ...item, divider: false });
      continue;
    }
    out.push(item);
  }
  return out;
}

export interface EditorMenuContext {
  canUndo: boolean;
  canRedo: boolean;
  readOnly: boolean;
  /** Ссылки и теги разбираются только в markdown (Р-069). */
  markdown: boolean;
  /** Есть ли что сворачивать и разворачивать на строке курсора. */
  canFold: boolean;
  canUnfold: boolean;
  /** Показываются ли невидимые символы: пункт с галочкой, а не действие. */
  invisibles: boolean;
}

export function editorMenu(ctx: EditorMenuContext, commands: Command[]): PopupItem[] {
  return tidy([
    fromCommand(commands, 'edit.undo', { disabled: !ctx.canUndo }),
    fromCommand(commands, 'edit.redo', { disabled: !ctx.canRedo }),

    fromCommand(commands, 'edit.cut', { divider: true, disabled: ctx.readOnly }),
    fromCommand(commands, 'edit.copy'),
    fromCommand(commands, 'edit.paste', { disabled: ctx.readOnly }),

    fromCommand(commands, 'edit.select-all', { divider: true }),

    fromCommand(commands, 'search.find', { divider: true }),
    fromCommand(commands, 'search.replace', { disabled: ctx.readOnly }),

    fromCommand(commands, 'view.invisibles', {
      divider: true,
      checked: ctx.invisibles,
    }),

    fromCommand(commands, 'view.fold', { divider: true, disabled: !ctx.canFold }),
    fromCommand(commands, 'view.unfold', { disabled: !ctx.canUnfold }),
    fromCommand(commands, 'view.fold-all'),
    fromCommand(commands, 'view.unfold-all'),

    ctx.markdown ? fromCommand(commands, 'project.follow-link', { divider: true }) : null,
    ctx.markdown ? fromCommand(commands, 'project.backlinks') : null,
  ]);
}

export interface TabMenuContext {
  modified: boolean;
  /** Буфер без файла на диске: копировать и показывать нечего. */
  hasFile: boolean;
  /** Сколько вкладок кроме этой. */
  others: number;
}

export function tabMenu(ctx: TabMenuContext, commands: Command[]): PopupItem[] {
  return tidy([
    fromCommand(commands, 'file.save', { disabled: !ctx.modified }),
    fromCommand(commands, 'file.save-as'),

    fromCommand(commands, 'file.close-tab', { divider: true }),
    {
      id: MENU.closeOthers,
      label: 'Закрыть другие',
      disabled: ctx.others === 0,
    },
    fromCommand(commands, 'file.close-all'),

    {
      id: MENU.copyPath,
      label: 'Копировать путь',
      divider: true,
      disabled: !ctx.hasFile,
    },
    { id: MENU.copyName, label: 'Копировать имя' },
    {
      id: MENU.reveal,
      label: 'Показать в проводнике',
      disabled: !ctx.hasFile,
      hint: ctx.hasFile ? 'Открыть папку с файлом и выделить его' : 'Файла на диске ещё нет',
    },
  ]);
}

export interface TreeRow {
  isDir: boolean;
  isRoot: boolean;
  /** Символьная ссылка: внутрь не заходим никогда (Р-054). */
  isLink: boolean;
  expanded: boolean;
}

export interface TreeMenuContext {
  /** `null` — щёлкнули по пустому месту панели. */
  row: TreeRow | null;
  /** Корень, если строка корневая: по нему видно, чего в папке не хватает. */
  root?: { hasProjectFile: boolean; hasObsidianConfig: boolean } | null;
}

export function treeMenu(ctx: TreeMenuContext, commands: Command[]): PopupItem[] {
  const row = ctx.row;
  if (!row) {
    // Пустое место панели: единственное осмысленное действие — добавить папку.
    return tidy([fromCommand(commands, 'project.add-root')]);
  }

  // Что делать с самой строкой. У файла — открыть, у папки — раскрыть;
  // внутрь ссылки не заходим никогда, поэтому у неё нет ни того, ни другого.
  const head: PopupItem[] = [];
  if (!row.isDir) {
    head.push({ id: MENU.open, label: 'Открыть' });
  } else if (!row.isLink) {
    head.push({ id: MENU.toggle, label: row.expanded ? 'Свернуть' : 'Раскрыть' });
    if (row.expanded) {
      head.push({
        id: MENU.refresh,
        label: 'Обновить',
        hint: 'Перечитать содержимое папки с диска',
      });
    }
  }

  // Что можно сделать с корнем — то же, что кнопками в строке дерева.
  const root: PopupItem[] = [];
  if (ctx.root) {
    if (!ctx.root.hasProjectFile) {
      root.push({ id: MENU.projectFile, label: 'Создать zeronote.toml' });
    }
    if (ctx.root.hasObsidianConfig) {
      root.push({ id: MENU.obsidian, label: 'Перенести настройки Obsidian' });
    }
    root.push({
      id: MENU.removeRoot,
      label: 'Убрать папку',
      danger: true,
      hint: 'Убрать из рабочего пространства. Файлы на диске остаются на месте.',
    });
    root[0] = { ...root[0]!, divider: true };
  }

  return tidy([
    ...head,

    { id: MENU.copyPath, label: 'Копировать путь', divider: true },
    { id: MENU.copyName, label: 'Копировать имя' },
    {
      id: MENU.reveal,
      label: 'Показать в проводнике',
      hint: row.isDir ? 'Открыть эту папку в проводнике' : 'Открыть папку с файлом и выделить его',
    },

    ...root,
  ]);
}

/**
 * Меню поля ввода — панели поиска, палитры, диалога.
 *
 * Нужно потому, что меню вебвью снято во всём окне: без своего меню правый
 * щелчок в поле поиска не делал бы ничего, а именно там его жмут чаще всего —
 * чтобы вставить.
 */
export function fieldMenu(
  ctx: { hasSelection: boolean; readOnly: boolean },
  commands: Command[],
): PopupItem[] {
  return tidy([
    fromCommand(commands, 'edit.cut', { disabled: !ctx.hasSelection || ctx.readOnly }),
    fromCommand(commands, 'edit.copy', { disabled: !ctx.hasSelection }),
    fromCommand(commands, 'edit.paste', { disabled: ctx.readOnly }),
    fromCommand(commands, 'edit.select-all', { divider: true }),
  ]);
}
