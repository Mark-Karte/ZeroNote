import { open as openDialog, save as saveDialog, ask, message } from '@tauri-apps/plugin-dialog';
import * as ipc from '../ipc/files';
import {
  activeTab,
  applyMeta,
  createEmpty,
  openPath,
  resetBaseline,
  tabById,
  textOf,
  close as closeTabState,
} from '../state/tabs.svelte';

/**
 * Действия над файлами: то, что вызывается из меню, горячих клавиш и вкладок.
 *
 * Здесь и только здесь живут системные диалоги и вопросы пользователю.
 * Ни `state/`, ни компоненты не должны ничего спрашивать сами — иначе одно
 * и то же действие начнёт вести себя по-разному в зависимости от того,
 * откуда его позвали.
 */

const FILTERS = [
  { name: 'Текст и заметки', extensions: ['txt', 'md', 'markdown', 'log', 'toml', 'json', 'ini', 'csv'] },
  { name: 'Все файлы', extensions: ['*'] },
];

async function report(error: unknown): Promise<void> {
  await message(String(error), { title: 'ZeroNote', kind: 'error' });
}

export async function newFile(): Promise<void> {
  try {
    await createEmpty();
  } catch (error) {
    await report(error);
  }
}

export async function openFiles(): Promise<void> {
  const selected = await openDialog({ multiple: true, filters: FILTERS });
  if (!selected) return;

  const paths = Array.isArray(selected) ? selected : [selected];
  for (const path of paths) {
    try {
      await openPath(path);
    } catch (error) {
      await report(error);
    }
  }
}

/** Открыть пути, пришедшие извне: перетаскивание файлов в окно. */
export async function openDropped(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await openPath(path);
    } catch (error) {
      await report(error);
    }
  }
}

async function writeTo(id: number, path?: string): Promise<boolean> {
  const tab = tabById(id);
  if (!tab) return false;

  try {
    const meta = await ipc.saveBuffer(id, textOf(tab), path);
    applyMeta(meta);
    // Текущий текст становится исходным: буфер чист.
    resetBaseline(id);
    return true;
  } catch (error) {
    await report(error);
    return false;
  }
}

export async function save(id: number): Promise<boolean> {
  const tab = tabById(id);
  if (!tab) return false;

  // Сохранять нечего — и это важно не только для скорости: перезапись
  // нетронутого файла со смешанными переносами изменила бы его (Р-018).
  if (!tab.meta.modified && tab.meta.path) return true;

  if (!tab.meta.path) return saveAs(id);
  return writeTo(id);
}

export async function saveAs(id: number): Promise<boolean> {
  const tab = tabById(id);
  if (!tab) return false;

  const path = await saveDialog({
    filters: FILTERS,
    defaultPath: tab.meta.path ?? tab.meta.title,
  });
  if (!path) return false;

  return writeTo(id, path);
}

export async function saveActive(): Promise<boolean> {
  const tab = activeTab();
  return tab ? save(tab.meta.id) : false;
}

export async function saveActiveAs(): Promise<boolean> {
  const tab = activeTab();
  return tab ? saveAs(tab.meta.id) : false;
}

/**
 * Закрыть вкладку, спросив про несохранённые правки.
 *
 * Возвращает `false`, если пользователь передумал: вызывающий код должен
 * на этом остановиться, а не закрывать остальные вкладки.
 */
export async function closeTab(id: number): Promise<boolean> {
  const tab = tabById(id);
  if (!tab) return true;

  if (tab.meta.modified) {
    const answer = await ask(
      `Сохранить изменения в «${tab.meta.title}» перед закрытием?`,
      { title: 'ZeroNote', kind: 'warning', okLabel: 'Сохранить', cancelLabel: 'Не сохранять' },
    );

    if (answer) {
      // Именно этот буфер, а не активный: закрывать можно и не текущую вкладку.
      const saved = await save(id);
      // Не сохранилось — закрывать нельзя, иначе правки пропадут молча.
      if (!saved) return false;
    }
  }

  await closeTabState(id);
  return true;
}
