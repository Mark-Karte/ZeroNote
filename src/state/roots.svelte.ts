import * as ipc from '../ipc/roots';
import type { Root } from '../ipc/roots';
// Взаимный импорт с tree: там только функции, и зовутся они в рантайме,
// поэтому порядок загрузки модулей роли не играет. Тот же приём, что
// у tabs и persist.
import { expand, forgetRoot } from './tree.svelte';

/**
 * Корни рабочего пространства и состояние боковой панели.
 *
 * Источник истины — ядро: там список живёт между запусками и оттуда же
 * приходят имена, доступность и жалобы на `zeronote.toml`. Здесь только
 * отражение этого списка для интерфейса.
 */
/** Какая панель показана в боковой полосе. */
export type PanelId = 'tree' | 'search' | 'links';

export const roots = $state<{
  items: Root[];
  sidebar: boolean;
  sidebarWidth: number;
  panel: PanelId;
}>({
  items: [],
  sidebar: false,
  /** Ноль — «как в теме»: ширину задаёт токен, пока её не подгонят руками. */
  sidebarWidth: 0,
  panel: 'tree',
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
  // случилось ли что-нибудь. Раскрываем сразу: свёрнутая папка на месте
  // только что открытой выглядит так же, как ничего не произошло.
  roots.sidebar = true;
  await expand(root.id, root.path);
  return root;
}

export async function remove(id: number): Promise<void> {
  const root = roots.items.find((r) => r.id === id);
  await ipc.removeRoot(id);
  const index = roots.items.findIndex((r) => r.id === id);
  if (index >= 0) roots.items.splice(index, 1);
  // Прочитанные папки этого корня больше никому не нужны.
  if (root) forgetRoot(root.path);
}

export function setSidebarWidth(width: number): void {
  roots.sidebarWidth = width;
}

/** Показать панель, открыв полосу, если она была закрыта. */
export function showPanel(panel: PanelId): void {
  roots.panel = panel;
  roots.sidebar = true;
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
export async function restoreFromSession(
  items: Root[],
  sidebar: boolean,
  sidebarWidth: number,
  panel: string,
): Promise<void> {
  roots.items.splice(0, roots.items.length, ...items);
  roots.sidebar = sidebar;
  roots.sidebarWidth = sidebarWidth;
  // Неизвестное имя панели из чужой или будущей версии не должно оставлять
  // полосу пустой.
  roots.panel =
    panel === 'search' || panel === 'links' ? (panel as PanelId) : 'tree';

  // Какие папки внутри были раскрыты, мы не помним — и не пытаемся: список
  // раскрытых узлов быстро устаревает, а восстановление несуществующих
  // ветвей выглядит как ошибка. Сами корни раскрываем: свёрнутый корень
  // после перезапуска ничем не отличается от отсутствующего.
  for (const root of items) {
    if (root.available) await expand(root.id, root.path);
  }
}

export function toggleSidebar(): void {
  roots.sidebar = !roots.sidebar;
}
