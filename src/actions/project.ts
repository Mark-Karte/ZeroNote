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
      ? `Правил исключения найдено: ${preview.rules.length}.`
      : 'Настроек, которые ZeroNote умеет переносить, в хранилище нет.',
    preview.skipped.length > 0
      ? `Не переносится (регулярные выражения): ${preview.skipped.join(', ')}.`
      : '',
    `В папке «${root.name}» будет создан zeronote.toml. В .obsidian ничего не записывается.`,
  ].filter((line) => line !== '');

  const answer = await askChoice('Перенести настройки Obsidian', lines.join('\n'), [
    { id: 'cancel', label: 'Отмена', cancel: true },
    { id: 'import', label: 'Перенести', primary: true },
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
    await message(
      `В хранилище «${name}» нет настроек, которые ZeroNote умеет переносить.`,
      { title: 'ZeroNote' },
    );
    return;
  }

  const text = [
    `# Настройки из .obsidian хранилища «${name}».`,
    '# Файл проекта уже существует, поэтому строки не вписаны автоматически:',
    '# дописать в TOML вторую таблицу [ignore] нельзя, а переписать ваш файл',
    '# целиком значило бы потерять комментарии. Перенесите руками.',
    '',
    '[ignore]',
    'rules = [',
    ...preview.rules.map((rule) => `    '${rule}',`),
    ']',
    ...(preview.skipped.length > 0
      ? [
          '',
          '# Эти фильтры Obsidian — регулярные выражения, и в правилах',
          '# игнорирования их не выразить. Перепишите вручную, если нужны:',
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
