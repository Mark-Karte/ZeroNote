import { describe, expect, it } from 'vitest';
import {
  MENU,
  editorMenu,
  fieldMenu,
  snippetMenu,
  tabMenu,
  treeMenu,
  type Command,
} from '../src/ui/menus';
import { commandIds } from '../src/keymap/registry';
import type { PopupItem } from '../src/ui/popup-item';

/**
 * Набор пунктов — это то, что должно проверяться числами, а не глазами
 * по одному щелчку за раз. Отсюда чистые построители в `ui/menus.ts`.
 */

/** Раскладка, какой её отдаёт ядро: имя команды, название и сочетание. */
const COMMANDS: Command[] = [
  { id: 'file.save', title: 'Сохранить', binding: 'ctrl+s' },
  { id: 'file.save-as', title: 'Сохранить как', binding: 'ctrl+alt+s' },
  { id: 'file.close-tab', title: 'Закрыть вкладку', binding: 'ctrl+w' },
  { id: 'file.close-all', title: 'Закрыть все вкладки', binding: 'ctrl+shift+w' },
  { id: 'edit.undo', title: 'Отменить', binding: 'ctrl+z' },
  { id: 'edit.redo', title: 'Повторить', binding: 'ctrl+y' },
  { id: 'edit.cut', title: 'Вырезать', binding: 'ctrl+x' },
  { id: 'edit.copy', title: 'Копировать', binding: 'ctrl+c' },
  { id: 'edit.paste', title: 'Вставить', binding: 'ctrl+v' },
  { id: 'edit.select-all', title: 'Выделить всё', binding: 'ctrl+a' },
  { id: 'search.find', title: 'Найти', binding: 'ctrl+f' },
  { id: 'search.replace', title: 'Заменить', binding: 'ctrl+h' },
  { id: 'project.follow-link', title: 'Перейти по ссылке под курсором', binding: 'f12' },
  { id: 'project.backlinks', title: 'Обратные ссылки', binding: 'ctrl+shift+b' },
  { id: 'project.add-root', title: 'Открыть папку', binding: 'ctrl+shift+o' },
  { id: 'view.fold', title: 'Свернуть блок', binding: 'ctrl+alt+f' },
  { id: 'view.unfold', title: 'Развернуть блок', binding: 'ctrl+alt+shift+f' },
  { id: 'view.fold-all', title: 'Свернуть всё', binding: 'alt+0' },
  { id: 'view.unfold-all', title: 'Развернуть всё', binding: 'alt+shift+0' },
  { id: 'view.invisibles', title: 'Показывать невидимые символы', binding: null },
  { id: 'view.bookmark', title: 'Поставить или снять закладку', binding: 'ctrl+f2' },
  { id: 'md.table', title: 'Заготовка: таблица', binding: null },
  { id: 'md.code-block', title: 'Заготовка: блок кода', binding: null },
  { id: 'md.divider', title: 'Заготовка: разделитель', binding: null },
];

const ids = (items: PopupItem[]): string[] => items.map((item) => item.id);

function item(items: PopupItem[], id: string): PopupItem {
  const found = items.find((entry) => entry.id === id);
  expect(found, `пункт ${id} не найден`).toBeDefined();
  return found!;
}

const EDITOR = {
  canUndo: true,
  canRedo: true,
  readOnly: false,
  markdown: false,
  canFold: true,
  canUnfold: true,
  invisibles: false,
  bookmarked: false,
};

describe('пункты по командам реестра', () => {
  /**
   * Р-107: пункт не заводит своё действие, а ссылается на команду. Значит,
   * все имена команд, на которые ссылаются меню, обязаны в реестре быть —
   * иначе пункт будет нажиматься и ничего не делать.
   */
  it('ссылаются только на существующие команды', () => {
    const known = new Set(commandIds());
    const all = [
      ...editorMenu({ ...EDITOR, markdown: true }, COMMANDS),
      ...tabMenu({ modified: true, hasFile: true, others: 2 }, COMMANDS),
      ...treeMenu({ row: null }, COMMANDS),
      ...fieldMenu({ hasSelection: true, readOnly: false }, COMMANDS),
      ...snippetMenu(COMMANDS),
    ];

    const referenced = ids(all).filter((id) => !id.startsWith('menu.'));
    const unknown = referenced.filter((id) => !known.has(id));

    expect(referenced.length).toBeGreaterThan(10);
    expect(unknown, 'пункт ссылается на несуществующую команду').toEqual([]);
  });

  it('берут название и сочетание из раскладки, а не из разметки', () => {
    const undo = item(editorMenu(EDITOR, COMMANDS), 'edit.undo');
    expect(undo.label).toBe('Отменить');
    expect(undo.key).toBe('ctrl+z');
  });

  /**
   * Сочетание могли снять в `keymap.toml`. Тогда пункт остаётся, а подписи
   * сочетания у него нет: показать «Ctrl Z» там, где ничего не нажимается,
   * было бы обманом.
   */
  it('обходятся без сочетания, когда его сняли', () => {
    const commands = COMMANDS.map((c) => (c.id === 'edit.undo' ? { ...c, binding: null } : c));
    expect(item(editorMenu(EDITOR, commands), 'edit.undo').key).toBeUndefined();
  });

  /** Пропала команда — пропал и пункт, а не остался мёртвым. */
  it('не показывают пункт, которому не на что сослаться', () => {
    const commands = COMMANDS.filter((c) => c.id !== 'edit.redo');
    expect(ids(editorMenu(EDITOR, commands))).not.toContain('edit.redo');
  });
});

describe('меню редактора', () => {
  it('гасит отмену и повтор, когда отменять нечего', () => {
    const items = editorMenu({ ...EDITOR, canUndo: false, canRedo: false }, COMMANDS);
    expect(item(items, 'edit.undo').disabled).toBe(true);
    expect(item(items, 'edit.redo').disabled).toBe(true);
  });

  /**
   * Файл только для чтения — большой или запрещённый к правке. Копировать
   * из него можно, менять нельзя.
   */
  it('в файле только для чтения гасит всё, что меняет текст', () => {
    const items = editorMenu({ ...EDITOR, readOnly: true }, COMMANDS);
    expect(item(items, 'edit.cut').disabled).toBe(true);
    expect(item(items, 'edit.paste').disabled).toBe(true);
    expect(item(items, 'search.replace').disabled).toBe(true);
    expect(item(items, 'edit.copy').disabled).toBeUndefined();
  });

  /**
   * Свёртка есть не везде: в обычном тексте и в языках без разбора дерева
   * сворачивать нечего. Пункт остаётся, но погашен — как отмена без истории.
   */
  it('гасит свёртку, когда на строке курсора сворачивать нечего', () => {
    const items = editorMenu({ ...EDITOR, canFold: false, canUnfold: false }, COMMANDS);
    expect(item(items, 'view.fold').disabled).toBe(true);
    expect(item(items, 'view.unfold').disabled).toBe(true);
    // «Свернуть всё» не гасится: оно про весь файл, а не про строку курсора.
    expect(item(items, 'view.fold-all').disabled).toBeUndefined();
  });

  /** Ссылки и теги разбираются только в markdown (Р-069). */
  it('показывает ссылки только в markdown', () => {
    expect(ids(editorMenu(EDITOR, COMMANDS))).not.toContain('project.follow-link');
    expect(ids(editorMenu({ ...EDITOR, markdown: true }, COMMANDS))).toContain(
      'project.follow-link',
    );
  });
});

describe('меню вкладки', () => {
  it('гасит сохранение, когда сохранять нечего', () => {
    const items = tabMenu({ modified: false, hasFile: true, others: 1 }, COMMANDS);
    expect(item(items, 'file.save').disabled).toBe(true);
  });

  it('гасит «закрыть другие», когда вкладка одна', () => {
    const items = tabMenu({ modified: true, hasFile: true, others: 0 }, COMMANDS);
    expect(item(items, MENU.closeOthers).disabled).toBe(true);
  });

  /** У буфера без файла нет ни пути, ни места в проводнике. Имя есть всегда. */
  it('гасит путь и проводник у буфера без файла', () => {
    const items = tabMenu({ modified: true, hasFile: false, others: 1 }, COMMANDS);
    expect(item(items, MENU.copyPath).disabled).toBe(true);
    expect(item(items, MENU.reveal).disabled).toBe(true);
    expect(item(items, MENU.copyName).disabled).toBeUndefined();
  });
});

describe('меню дерева', () => {
  const file = { isDir: false, isRoot: false, isLink: false, expanded: false };
  const dir = { isDir: true, isRoot: false, isLink: false, expanded: false };

  it('у файла предлагает открыть', () => {
    expect(ids(treeMenu({ row: file }, COMMANDS))).toEqual([
      MENU.open,
      MENU.newFile,
      MENU.newFolder,
      MENU.rename,
      MENU.delete,
      MENU.copyPath,
      MENU.copyName,
      MENU.reveal,
    ]);
  });

  /** Удаление необратимо на вид, и цвет должен об этом говорить (Р-093). */
  it('помечает удаление опасным', () => {
    expect(item(treeMenu({ row: file }, COMMANDS), MENU.delete).danger).toBe(true);
  });

  /**
   * У корня переименования и удаления нет: за ним тянутся запись в сессии,
   * наблюдатель и содержимое индекса. Для него есть «Убрать папку».
   */
  it('у корня не предлагает переименовать и удалить', () => {
    const items = treeMenu(
      {
        row: { ...dir, isRoot: true },
        root: { hasProjectFile: true, hasObsidianConfig: false },
      },
      COMMANDS,
    );

    expect(ids(items)).not.toContain(MENU.rename);
    expect(ids(items)).not.toContain(MENU.delete);
    // А создать внутри корня — можно и нужно.
    expect(ids(items)).toContain(MENU.newFile);
    expect(ids(items)).toContain(MENU.removeRoot);
  });

  it('у папки предлагает раскрыть, а у раскрытой — свернуть и обновить', () => {
    expect(item(treeMenu({ row: dir }, COMMANDS), MENU.toggle).label).toBe('Раскрыть');

    const open = treeMenu({ row: { ...dir, expanded: true } }, COMMANDS);
    expect(item(open, MENU.toggle).label).toBe('Свернуть');
    expect(ids(open)).toContain(MENU.refresh);
  });

  /** Внутрь ссылки не заходим никогда (Р-054), поэтому и раскрывать нечего. */
  it('у ссылки не предлагает ни открыть, ни раскрыть', () => {
    const link = treeMenu({ row: { ...dir, isLink: true } }, COMMANDS);
    expect(ids(link)).not.toContain(MENU.toggle);
    expect(ids(link)).not.toContain(MENU.open);
    expect(ids(link)).toContain(MENU.copyPath);
  });

  it('у корня добавляет то же, что кнопками строки', () => {
    const items = treeMenu(
      {
        row: { ...dir, isRoot: true },
        root: { hasProjectFile: false, hasObsidianConfig: true },
      },
      COMMANDS,
    );
    expect(ids(items)).toContain(MENU.projectFile);
    expect(ids(items)).toContain(MENU.obsidian);
    expect(item(items, MENU.removeRoot).danger).toBe(true);
  });

  it('не предлагает создать zeronote.toml, когда он уже есть', () => {
    const items = treeMenu(
      {
        row: { ...dir, isRoot: true },
        root: { hasProjectFile: true, hasObsidianConfig: false },
      },
      COMMANDS,
    );
    expect(ids(items)).not.toContain(MENU.projectFile);
    expect(ids(items)).not.toContain(MENU.obsidian);
  });

  it('на пустом месте предлагает открыть папку', () => {
    expect(ids(treeMenu({ row: null }, COMMANDS))).toEqual(['project.add-root']);
  });
});

describe('меню поля ввода', () => {
  it('гасит вырезание и копирование без выделения', () => {
    const items = fieldMenu({ hasSelection: false, readOnly: false }, COMMANDS);
    expect(item(items, 'edit.cut').disabled).toBe(true);
    expect(item(items, 'edit.copy').disabled).toBe(true);
    expect(item(items, 'edit.paste').disabled).toBe(false);
  });
});

describe('черта между группами', () => {
  /**
   * Черта первым пунктом — это рамка сверху и пустая строка на месте
   * пропавшей группы. След от скрытого пункта, а не разделение.
   */
  it('не остаётся первой строкой меню', () => {
    const commands = COMMANDS.filter((c) => !c.id.startsWith('edit.'));
    const items = editorMenu(EDITOR, commands);

    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.divider).toBeFalsy();
  });
});
