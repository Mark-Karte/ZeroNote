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

/** Удалить в корзину. Мимо корзины не удаляет никогда (Р-110). */
export const deleteEntry = (path: string): Promise<void> =>
  invoke('delete_entry', { path });
