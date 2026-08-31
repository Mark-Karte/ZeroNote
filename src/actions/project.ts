import { open as openDialog, message } from '@tauri-apps/plugin-dialog';

import {
  roots,
  add,
  remove,
  createProjectFile,
  toggleSidebar,
  showPanel,
} from '../state/roots.svelte';
import { noteStructureChange } from '../state/persist.svelte';
import { askChoice } from '../state/modal.svelte';
import { open as openPalette } from '../state/palette.svelte';
import { focusSearch } from '../state/project-search.svelte';

/**
 * Действия над корнями: то, что вызывается из панели и горячих клавиш.
 *
 * Здесь и только здесь живут системные диалоги и вопросы пользователю —
 * то же правило, что и у действий над файлами.
 */

async function report(error: unknown): Promise<void> {
  await message(String(error), { title: 'ZeroNote', kind: 'error' });
}

/** Открыть папку как корень. */
export async function addRootDialog(): Promise<void> {
  const selected = await openDialog({ directory: true, multiple: false });
  if (typeof selected !== 'string') return;

  try {
    await add(selected);
    noteStructureChange();
  } catch (error) {
    await report(error);
  }
}

/** Убрать корень из рабочего пространства. Папку на диске это не трогает. */
export async function removeRoot(id: number): Promise<void> {
  try {
    await remove(id);
    noteStructureChange();
  } catch (error) {
    await report(error);
  }
}

/**
 * Создать `zeronote.toml` в корне.
 *
 * Спрашиваем перед записью, и это не перестраховка: файл появляется в чужой
 * папке, которая вполне может быть чужим репозиторием (Р-049).
 */
export async function createProject(id: number): Promise<void> {
  const root = roots.items.find((r) => r.id === id);
  if (!root) return;

  const answer = await askChoice(
    'Создать файл проекта',
    `В папке «${root.name}» будет создан файл zeronote.toml с настройками по умолчанию. Его можно править руками и класть в git.`,
    [
      { id: 'cancel', label: 'Отмена', cancel: true },
      { id: 'create', label: 'Создать', primary: true },
    ],
  );
  if (answer !== 'create') return;

  try {
    await createProjectFile(id);
  } catch (error) {
    await report(error);
  }
}

/** Быстрое открытие по имени. */
export function quickOpen(): void {
  openPalette();
}

/** Перейти по ссылке под курсором. */
export async function followLink(): Promise<void> {
  const { followAtCursor } = await import('../state/links.svelte');
  await followAtCursor();
}

/** Показать, кто ссылается на открытую заметку. */
export function showBacklinks(): void {
  showPanel('links');
  noteStructureChange();
}

/** Поиск по проекту: открыть панель и забрать фокус в поле. */
export function searchInProject(): void {
  showPanel('search');
  focusSearch();
  noteStructureChange();
}

export function toggleSidebarPanel(): void {
  toggleSidebar();
  // Открыта панель или закрыта — часть сессии: закрыв её, пользователь
  // не должен обнаружить её открытой после перезапуска.
  noteStructureChange();
}
