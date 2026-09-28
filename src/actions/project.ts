import { open as openDialog, message } from '@tauri-apps/plugin-dialog';

import * as ipcRoots from '../ipc/roots';
import {
  roots,
  add,
  remove,
  createProjectFile,
  toggleSidebar,
  showPanel,
  put,
} from '../state/roots.svelte';
import { createEmpty } from '../state/tabs.svelte';
import { noteStructureChange } from '../state/persist.svelte';
import { askChoice } from '../state/modal.svelte';
import { t, tn } from '../l10n';
import { open as openPalette } from '../state/palette.svelte';
import { refresh as refreshSettings } from '../state/settings.svelte';
import { openSettings } from '../state/tabs.svelte';
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
    t('project.file.create.title'),
    t('project.file.create.text', { folder: root.name }),
    [
      { id: 'cancel', label: t('common.cancel'), cancel: true },
      { id: 'create', label: t('common.create'), primary: true },
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

/**
 * Палитра команд и палитра тегов — то же самое поле с подставленным префиксом.
 *
 * Отдельных окон нет и не будет (Р-076): три поля с тремя сочетаниями надо
 * запоминать, а одно с префиксами подсказывает само. Сочетания при этом
 * остаются привычными — Ctrl+Shift+P открывает команды, как везде.
 */
export function commandPalette(): void {
  openPalette('commands');
}

export function tagPalette(): void {
  openPalette('tags');
}

/**
 * Параметры: вкладка, а не режим окна (Р-185).
 *
 * Повторный вызов не закрывает их, а показывает открытую вкладку: закрыть
 * её можно крестиком, как всякую другую. Прежнее поведение — «та же кнопка
 * открывает и закрывает» — владелец назвал неудобным первым же пунктом
 * замечаний из работы.
 */
export async function showSettings(): Promise<void> {
  await openSettings();
  // Файл могли поправить руками, пока вкладки не было на экране.
  refreshSettings();
}

/**
 * Перенести настройки Obsidian в наш файл проекта.
 *
 * Односторонне и один раз (Р-022, пункт 2). Обратно ничего не
 * синхронизируется, результат правится руками.
 */
export async function importFromObsidian(id: number): Promise<void> {
  const root = roots.items.find((r) => r.id === id);
  if (!root) return;

  let preview: ipcRoots.ObsidianPreview;
  try {
    preview = await ipcRoots.obsidianPreview(id);
  } catch (error) {
    await report(error);
    return;
  }

  // Файл проекта уже есть. Дописать в него нельзя, не потеряв комментарии
  // пользователя (Р-072), — поэтому показываем готовые строки в новой
  // вкладке, а вставит он их сам.
  if (preview.projectFileExists) {
    await showRulesToPaste(root.name, preview);
    return;
  }

  const lines = [
    preview.rules.length > 0
      ? tn('project.obsidian.rules', preview.rules.length)
      : t('project.obsidian.none'),
    preview.skipped.length > 0
      ? t('project.obsidian.skipped', { list: preview.skipped.join(', ') })
      : '',
    t('project.obsidian.target', { folder: root.name }),
  ].filter((line) => line !== '');

  const answer = await askChoice(t('project.obsidian'), lines.join('\n'), [
    { id: 'cancel', label: t('common.cancel'), cancel: true },
    { id: 'import', label: t('project.obsidian.confirm'), primary: true },
  ]);
  if (answer !== 'import') return;

  try {
    put(await ipcRoots.obsidianImport(id));
  } catch (error) {
    await report(error);
  }
}

/** Показать готовые строки для вставки руками — файл проекта уже есть. */
async function showRulesToPaste(
  name: string,
  preview: ipcRoots.ObsidianPreview,
): Promise<void> {
  if (preview.rules.length === 0 && preview.skipped.length === 0) {
    await message(t('project.obsidian.nothing', { name }), { title: 'ZeroNote' });
    return;
  }

  const text = [
    t('project.obsidian.paste.head', { name }),
    '',
    '[ignore]',
    'rules = [',
    ...preview.rules.map((rule) => `    '${rule}',`),
    ']',
    ...(preview.skipped.length > 0
      ? [
          '',
          t('project.obsidian.paste.skipped'),
          ...preview.skipped.map((filter) => `#   ${filter}`),
        ]
      : []),
  ].join('\n');

  await createEmpty(text);
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

/** Показать оглавление открытой заметки. */
export function showOutline(): void {
  showPanel('outline');
  noteStructureChange();
}

/** Показать теги проекта. */
export function showTags(): void {
  showPanel('tags');
  noteStructureChange();
}

/** Показать закладки открытых вкладок. */
export function showBookmarks(): void {
  showPanel('bookmarks');
  noteStructureChange();
}

/** Показать заметки: дом для записей рядом с проектами (задача 94). */
export function showNotes(): void {
  showPanel('notes');
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
