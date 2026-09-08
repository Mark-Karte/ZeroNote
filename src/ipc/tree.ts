import { invoke } from '@tauri-apps/api/core';

import type { FileEdits } from './edits';

// Правка файлов по плану переехала в `ipc/edits`: ею пользуется и замена
// по проекту (задача 88). Здесь остаётся то, что про дерево.
export type { FileEdits };

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

/**
 * Что придётся поправить, если переименовать (Р-136).
 *
 * Пути файлов — те, по которым они окажутся **после** переименования: файл
 * со ссылками может и сам лежать внутри переименовываемой папки.
 */
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

/** Удалить в корзину. Мимо корзины не удаляет никогда (Р-110). */
export const deleteEntry = (path: string): Promise<void> =>
  invoke('delete_entry', { path });
