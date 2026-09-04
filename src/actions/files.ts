import { open as openDialog, save as saveDialog, message } from '@tauri-apps/plugin-dialog';
import * as ipc from '../ipc/files';
import {
  activeTab,
  applyMeta,
  createEmpty,
  openPath,
  resetBaseline,
  tabById,
  textOf,
  tabs,
  close as closeTabState,
} from '../state/tabs.svelte';
import { askChoice } from '../state/modal.svelte';
import { forgetDraft, noteStructureChange } from '../state/persist.svelte';
import { autosavable } from '../state/autosave-rules';
import { resolveMixedLineEndings } from './encoding';
import { confirmOverwrite } from './external';

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

  // Файл со смешанными переносами нельзя записать обратно как есть, и решать
  // за пользователя, к чему его привести, мы не будем (Р-018).
  if (!(await resolveMixedLineEndings(id))) return false;

  try {
    let result = await ipc.saveBuffer(id, textOf(tab), path);

    // Файл изменили между чтением и сохранением. Молча затирать чужую
    // работу нельзя — спрашиваем и пишем только с разрешения.
    if (result.conflict) {
      if (!(await confirmOverwrite(id))) return false;
      result = await ipc.saveBuffer(id, textOf(tab), path, true);
    }

    if (!result.buffer) return false;

    applyMeta(result.buffer);
    // Текущий текст становится исходным: буфер чист.
    resetBaseline(id);
    // Содержимое доехало до настоящего файла — черновик больше не нужен.
    await forgetDraft(id);
    noteStructureChange();
    return true;
  } catch (error) {
    await report(error);
    return false;
  }
}

/**
 * Записать всё, что можно записать, ни о чём не спрашивая (Р-141).
 *
 * Возвращает жалобы: диск переполнен, файл стал недоступен. Молчать о них
 * нельзя — человек уверен, что его работа на диске, — но и диалогом
 * останавливать набор незачем, поэтому они едут в полосу предупреждений.
 *
 * Расхождение с диском не жалоба, а обычное дело: файл поправили в другой
 * программе. Такую вкладку пропускаем, и при возвращении фокуса в окно
 * человек получит обычный вопрос (Р-014).
 */
export async function autosaveAll(): Promise<string[]> {
  const complaints: string[] = [];
  let saved = false;

  // Снимок списка: `applyMeta` правит вкладки, а между шагами есть await.
  for (const tab of [...tabs.items]) {
    if (!autosavable(tab.meta)) continue;

    try {
      const result = await ipc.saveBuffer(tab.meta.id, textOf(tab));
      if (result.conflict || !result.buffer) continue;

      applyMeta(result.buffer);
      resetBaseline(tab.meta.id);
      await forgetDraft(tab.meta.id);
      saved = true;
    } catch (error) {
      complaints.push(`не удалось сохранить «${tab.meta.title}»: ${String(error)}`);
    }
  }

  if (saved) noteStructureChange();
  return complaints;
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

/** Сохранить все изменённые вкладки. Отказ на любой прекращает обход. */
export async function saveAll(): Promise<boolean> {
  for (const id of tabs.items.map((t) => t.meta.id)) {
    const tab = tabById(id);
    if (!tab?.meta.modified) continue;
    if (!(await save(id))) return false;
  }
  return true;
}

export async function closeActiveTab(): Promise<boolean> {
  const tab = activeTab();
  return tab ? closeTab(tab.meta.id) : true;
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
    // Три варианта, а не два: у системного диалога Tauri их только два, и
    // «отмена» в нём означала бы «не сохранять», то есть тихую потерю правок.
    const answer = await askChoice(
      'Есть несохранённые изменения',
      `Сохранить изменения в «${tab.meta.title}» перед закрытием?`,
      [
        { id: 'cancel', label: 'Отмена', cancel: true },
        { id: 'discard', label: 'Не сохранять', danger: true },
        { id: 'save', label: 'Сохранить', primary: true },
      ],
    );

    if (answer === null || answer === 'cancel') return false;

    if (answer === 'save') {
      // Именно этот буфер, а не активный: закрывать можно и не текущую вкладку.
      const saved = await save(id);
      // Не сохранилось — закрывать нельзя, иначе правки пропадут молча.
      if (!saved) return false;
    }
  }

  await closeTabState(id);
  return true;
}

/**
 * Закрыть все вкладки, спрашивая про каждую изменённую.
 *
 * Возвращает `false`, если пользователь передумал хотя бы на одной: тогда
 * закрытие окна должно быть отменено целиком.
 */
export async function closeAllTabs(): Promise<boolean> {
  // Копия списка: закрытие меняет исходный массив прямо во время обхода.
  const ids = tabs.items.map((t) => t.meta.id);

  for (const id of ids) {
    if (!(await closeTab(id))) return false;
  }
  return true;
}

/**
 * Закрыть все вкладки, кроме одной.
 *
 * Список снимается до обхода и не включает саму вкладку: закрытие меняет
 * `tabs.items` прямо во время работы. Отказ на любом вопросе останавливает
 * закрытие целиком — как и в «закрыть все».
 */
export async function closeOtherTabs(keep: number): Promise<boolean> {
  const ids = tabs.items.map((t) => t.meta.id).filter((id) => id !== keep);

  for (const id of ids) {
    if (!(await closeTab(id))) return false;
  }
  return true;
}

/** Показать файл или папку в проводнике. */
export async function revealInExplorer(path: string): Promise<void> {
  try {
    await ipc.revealPath(path);
  } catch (error) {
    await report(error);
  }
}
