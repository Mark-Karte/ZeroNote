import { message } from '@tauri-apps/plugin-dialog';
import * as ipc from '../ipc/tree';
import { moveBuffer } from '../ipc/files';
import { askChoice, askInput } from '../state/modal.svelte';
import { applyMeta, tabs, close as closeTabState } from '../state/tabs.svelte';
import { refreshDirs } from '../state/tree.svelte';
import { openDropped } from './files';

/**
 * Создание, переименование и удаление в дереве.
 *
 * Спрашиваем здесь и только здесь — так же, как со всеми действиями над
 * файлами: `state/` и компоненты ничего не спрашивают сами, иначе одно и то же
 * действие вело бы себя по-разному в зависимости от того, откуда его позвали.
 *
 * Отказы ядра показываются как есть: они написаны по-человечески и объясняют
 * причину, а не код ошибки.
 */

async function report(error: unknown): Promise<void> {
  await message(String(error), { title: 'ZeroNote', kind: 'error' });
}

/** Папка, содержимое которой надо перечитать после операции над этим путём. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf('\\');
  return cut > 0 ? path.slice(0, cut) : path;
}

export async function createEntry(parent: string, folder: boolean): Promise<void> {
  const name = await askInput(
    folder ? 'Новая папка' : 'Новый файл',
    `Имя ${folder ? 'папки' : 'файла'} внутри «${parent}».`,
    '',
    'Создать',
  );
  if (name === null || name.trim() === '') return;

  try {
    const path = await ipc.createEntry(parent, name, folder);
    await refreshDirs([parent]);
    // Созданный файл сразу открывается: его для того и создавали. Папку —
    // нет, открывать в ней нечего.
    if (!folder) await openDropped([path]);
  } catch (error) {
    await report(error);
  }
}

/**
 * Переименовать файл или папку.
 *
 * Открытые вкладки после этого переезжают вместе с файлом: путь в буфере
 * иначе остался бы прежним, и сохранение записало бы файл обратно под старым
 * именем — то есть создало бы копию, которую никто не просил.
 */
export async function renameEntry(path: string, oldName: string): Promise<void> {
  const name = await askInput(
    'Переименовать',
    `Новое имя для «${oldName}».`,
    oldName,
    'Переименовать',
  );
  if (name === null || name.trim() === '' || name === oldName) return;

  try {
    const moved = await ipc.renameEntry(path, name);
    await movedTabs(path, moved);
    await refreshDirs([parentOf(path)]);
  } catch (error) {
    await report(error);
  }
}

/**
 * Переставить пути у открытых вкладок после переименования.
 *
 * Не только у самого файла: переименовали папку — переехало всё, что внутри
 * неё открыто. Без этого сохранение любой такой вкладки создало бы файл
 * по несуществующему пути.
 */
async function movedTabs(from: string, to: string): Promise<void> {
  const prefix = `${from}\\`;

  for (const tab of [...tabs.items]) {
    const path = tab.meta.path;
    if (path === null) continue;

    let target: string | null = null;
    if (path === from) {
      target = to;
    } else if (path.startsWith(prefix)) {
      target = to + path.slice(from.length);
    }

    if (target !== null) {
      const list = await moveBuffer(tab.meta.id, target);
      const meta = list.find((buffer) => buffer.id === tab.meta.id);
      if (meta) applyMeta(meta);
    }
  }
}

/**
 * Удалить в корзину.
 *
 * Вопрос свой, а не системный: в системном необратимый вариант неотличим
 * от обычного (Р-027), а безопасным по умолчанию должен быть отказ (Р-093).
 * Мимо корзины ядро не удаляет никогда — Р-110.
 */
export async function deleteEntry(path: string, name: string, folder: boolean): Promise<void> {
  const answer = await askChoice(
    folder ? 'Удалить папку' : 'Удалить файл',
    `«${name}» ${folder ? 'и всё, что внутри, отправится' : 'отправится'} в корзину.` +
      '\n\nОттуда его можно вернуть.',
    [
      { id: 'cancel', label: 'Отмена', cancel: true, primary: true },
      { id: 'delete', label: 'В корзину', danger: true },
    ],
  );
  if (answer !== 'delete') return;

  try {
    await ipc.deleteEntry(path);
    await closeTabsUnder(path);
    await refreshDirs([parentOf(path)]);
  } catch (error) {
    await report(error);
  }
}

/**
 * Закрыть вкладки удалённого.
 *
 * Через состояние, а не через обычное закрытие с вопросом: файла уже нет,
 * и предлагать «сохранить изменения перед закрытием» означало бы предложить
 * создать его заново — ровно то, от чего человек только что отказался.
 */
async function closeTabsUnder(path: string): Promise<void> {
  const prefix = `${path}\\`;

  for (const tab of [...tabs.items]) {
    const open = tab.meta.path;
    if (open !== null && (open === path || open.startsWith(prefix))) {
      await closeTabState(tab.meta.id);
    }
  }
}
