import * as ipc from '../ipc/tree';
import type { TreeEntry } from '../ipc/tree';
import { roots } from './roots.svelte';

/**
 * Дерево файлов.
 *
 * Содержимое хранится по папкам, а не одним деревом объектов: раскрытие,
 * перечитывание по событию файловой системы и освобождение памяти при
 * сворачивании — всё это операции над одной папкой, и структура повторяет
 * то, как с ней работают.
 *
 * Дерево не обходится целиком ни здесь, ни в ядре. Раскрыли папку —
 * прочитали её, и только её.
 */

export const tree = $state<{
  /** Пути раскрытых папок, включая сами корни. */
  expanded: string[];
  /** Путь папки → её содержимое. */
  children: Record<string, TreeEntry[]>;
  /** Путь папки → почему её не удалось прочитать. */
  failed: Record<string, string>;
  /** Папки, чтение которых сейчас идёт: строка показывает это. */
  loading: string[];
}>({
  expanded: [],
  children: {},
  failed: {},
  loading: [],
});

/** Windows не различает регистр путей, а событие может прийти в любом. */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function insidePath(dir: string, path: string): boolean {
  const a = dir.toLowerCase();
  const b = path.toLowerCase();
  if (a === b) return true;
  return b.startsWith(a.endsWith('\\') ? a : `${a}\\`);
}

/** Корень, которому принадлежит путь. При вложенных корнях — ближний. */
function ownerRoot(path: string): { id: number; path: string } | null {
  let best: { id: number; path: string } | null = null;
  for (const root of roots.items) {
    if (!insidePath(root.path, path)) continue;
    if (!best || root.path.length > best.path.length) {
      best = { id: root.id, path: root.path };
    }
  }
  return best;
}

export function isExpanded(path: string): boolean {
  return tree.expanded.some((p) => samePath(p, path));
}

async function load(rootId: number, path: string, isRoot: boolean): Promise<void> {
  if (!tree.loading.includes(path)) tree.loading.push(path);
  try {
    const entries = await ipc.readChildren(rootId, isRoot ? '' : path);
    tree.children[path] = entries;
    delete tree.failed[path];
  } catch (error) {
    // Папку могли удалить или закрыть доступ прямо сейчас. Это не повод
    // ронять панель: строка покажет, что прочитать не удалось.
    tree.failed[path] = String(error);
    tree.children[path] = [];
  } finally {
    const index = tree.loading.indexOf(path);
    if (index >= 0) tree.loading.splice(index, 1);
  }
}

export async function expand(rootId: number, path: string): Promise<void> {
  if (!isExpanded(path)) tree.expanded.push(path);

  const isRoot = roots.items.some((r) => samePath(r.path, path));
  // Уже прочитанное не перечитываем: за свежесть отвечает слежение.
  if (!tree.children[path]) {
    await load(rootId, path, isRoot);
  }
}

export function collapse(path: string): void {
  const index = tree.expanded.findIndex((p) => samePath(p, path));
  if (index >= 0) tree.expanded.splice(index, 1);

  // Содержимое свёрнутой папки забываем. Хранилище на сто тысяч файлов
  // иначе оседает в памяти целиком за один вечер работы.
  delete tree.children[path];
  delete tree.failed[path];
}

export async function toggle(rootId: number, path: string): Promise<void> {
  if (isExpanded(path)) {
    collapse(path);
  } else {
    await expand(rootId, path);
  }
}

/** Корень убрали из рабочего пространства — забыть всё, что под ним. */
export function forgetRoot(rootPath: string): void {
  tree.expanded = tree.expanded.filter((p) => !insidePath(rootPath, p));
  for (const key of Object.keys(tree.children)) {
    if (insidePath(rootPath, key)) delete tree.children[key];
  }
  for (const key of Object.keys(tree.failed)) {
    if (insidePath(rootPath, key)) delete tree.failed[key];
  }
}

/**
 * Событие слежения: перечитать те из названных папок, которые раскрыты.
 *
 * Невидимое не перечитываем — иначе распаковка архива где-то в глубине
 * проекта обошлась бы в сотню обращений к диску без единого изменения
 * на экране.
 */
export async function refreshDirs(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    if (!isExpanded(dir)) continue;
    const owner = ownerRoot(dir);
    if (!owner) continue;
    await load(owner.id, dir, samePath(owner.path, dir));
  }
}

/** Строка плоского списка, из которого рисуется дерево. */
export interface Row {
  rootId: number;
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  isLink: boolean;
  isRoot: boolean;
  expanded: boolean;
}

/**
 * Развернуть раскрытые папки в плоский список.
 *
 * Плоский он потому, что рисуется виртуализованным списком: на экране живут
 * только видимые строки, а вложенность передаётся отступом. Дерево из
 * вложенных компонентов такого не позволяет.
 */
export function rows(): Row[] {
  const out: Row[] = [];

  const walk = (rootId: number, dir: string, depth: number): void => {
    for (const entry of tree.children[dir] ?? []) {
      const expanded = entry.isDir && isExpanded(entry.path);
      out.push({
        rootId,
        path: entry.path,
        name: entry.name,
        depth,
        isDir: entry.isDir,
        isLink: entry.isLink,
        isRoot: false,
        expanded,
      });
      // Внутрь ссылки не заходим никогда: `ссылка → родительская папка` —
      // это петля без дна (Р-054).
      if (expanded && !entry.isLink) {
        walk(rootId, entry.path, depth + 1);
      }
    }
  };

  for (const root of roots.items) {
    const expanded = isExpanded(root.path);
    out.push({
      rootId: root.id,
      path: root.path,
      name: root.name,
      depth: 0,
      isDir: true,
      isLink: false,
      isRoot: true,
      expanded,
    });
    if (expanded && root.available) {
      walk(root.id, root.path, 1);
    }
  }

  return out;
}
