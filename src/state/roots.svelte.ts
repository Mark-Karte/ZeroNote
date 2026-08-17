import * as ipc from '../ipc/roots';
import type { Root } from '../ipc/roots';

/**
 * Корни рабочего пространства и состояние боковой панели.
 *
 * Источник истины — ядро: там список живёт между запусками и оттуда же
 * приходят имена, доступность и жалобы на `zeronote.toml`. Здесь только
 * отражение этого списка для интерфейса.
 */
export const roots = $state<{ items: Root[]; sidebar: boolean }>({
  items: [],
  sidebar: false,
});

/** Жалобы всех корней разом — для полосы предупреждений. */
export function rootProblems(): string[] {
  return roots.items.flatMap((root) => root.problems ?? []);
}

/** Заменить корень в списке тем, что вернуло ядро. */
function put(fresh: Root): void {
  const index = roots.items.findIndex((r) => r.id === fresh.id);
  if (index < 0) {
    roots.items.push(fresh);
  } else {
    roots.items[index] = fresh;
  }
}

export async function add(path: string): Promise<Root> {
  const root = await ipc.addRoot(path);
  put(root);
  // Открыть папку и не показать её — значит, оставить пользователя гадать,
  // случилось ли что-нибудь.
  roots.sidebar = true;
  return root;
}

export async function remove(id: number): Promise<void> {
  await ipc.removeRoot(id);
  const index = roots.items.findIndex((r) => r.id === id);
  if (index >= 0) roots.items.splice(index, 1);
}

export async function createProjectFile(id: number): Promise<Root> {
  const root = await ipc.createProjectFile(id);
  put(root);
  return root;
}

/**
 * Перечитать корни: файлы проектов и доступность папок.
 *
 * Зовётся при возвращении фокуса в окно — тогда же, когда сверяются открытые
 * файлы (Р-014): именно в этот момент пользователь мог поправить
 * `zeronote.toml` в другой программе или подключить пропавший диск.
 */
export async function refresh(): Promise<void> {
  const fresh = await ipc.refreshRoots();
  roots.items.splice(0, roots.items.length, ...fresh);
}

/** Принять список, восстановленный из сессии. */
export function restoreFromSession(items: Root[], sidebar: boolean): void {
  roots.items.splice(0, roots.items.length, ...items);
  roots.sidebar = sidebar;
}

export function toggleSidebar(): void {
  roots.sidebar = !roots.sidebar;
}
