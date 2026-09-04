import { invoke } from '@tauri-apps/api/core';

/** Одна строка дерева: файл или папка. */
export interface TreeEntry {
  path: string;
  name: string;
  isDir: boolean;
  /** Символьная ссылка или точка соединения. Внутрь не заходим — Р-054. */
  isLink: boolean;
}

/**
 * Прочитать содержимое одной папки.
 *
 * Дерево целиком не обходится никогда: читается ровно та папка, которую
 * раскрыли. Пустой путь означает сам корень.
 */
export const readChildren = (rootId: number, path: string): Promise<TreeEntry[]> =>
  invoke('read_children', { rootId, path });

/** Событие ядра: содержимое перечисленных папок могло измениться. */
export const TREE_CHANGED = 'tree-changed';

/** Создать пустой файл или папку. Возвращает путь созданного. */
export const createEntry = (parent: string, name: string, folder: boolean): Promise<string> =>
  invoke('create_entry', { parent, name, folder });

/** Переименовать. Возвращает новый путь. */
export const renameEntry = (path: string, name: string): Promise<string> =>
  invoke('rename_entry', { path, name });

/** Одна замена в файле: где, что было и что станет. */
export interface LinkEdit {
  /** Смещение цели ссылки в байтах от начала файла. */
  offset: number;
  was: string;
  becomes: string;
}

/** Что изменится в одном файле. */
export interface FileEdits {
  /** Путь после переименования: файл со ссылками мог и сам переехать. */
  path: string;
  /** Путь внутри корня — его и показывают человеку. */
  inside: string;
  edits: LinkEdit[];
}

/** Что придётся поправить, если переименовать (Р-136). */
export interface RenamePlan {
  target: string;
  files: FileEdits[];
  links: number;
}

/**
 * Спросить план **до** переименования. Ничего не меняет.
 *
 * Считается симуляцией переименования в откатываемой транзакции (Р-137),
 * поэтому список точен: в нём только те ссылки, которые и правда разъедутся.
 */
export const planRename = (path: string, name: string): Promise<RenamePlan> =>
  invoke('plan_rename', { path, name });

/** Поправить ссылки по плану. Возвращает жалобы на то, что не вышло. */
export const applyLinkEdits = (files: FileEdits[]): Promise<string[]> =>
  invoke('apply_link_edits', { files });

/** Удалить в корзину. Мимо корзины не удаляет никогда (Р-110). */
export const deleteEntry = (path: string): Promise<void> =>
  invoke('delete_entry', { path });
