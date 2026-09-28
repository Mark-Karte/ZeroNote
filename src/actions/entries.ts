import { message } from '@tauri-apps/plugin-dialog';
import * as ipc from '../ipc/tree';
import { markDetached, moveBuffer } from '../ipc/files';
import { applyEdits } from '../ipc/edits';
import { askChoice, askInput } from '../state/modal.svelte';
import {
  applyMeta,
  markChanged,
  tabs,
  unsavedPaths,
  close as closeTabState,
} from '../state/tabs.svelte';
import { refreshDirs } from '../state/tree.svelte';
import { openDropped } from './files';
import { checkExternalChanges } from './external';
import { describePlan, movedPath, splitPlan } from './rename-plan';
import type { FileEdits } from '../ipc/tree';
import { t } from '../l10n';

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
    folder ? t('entries.new-folder') : t('entries.new-file'),
    folder
      ? t('entries.new-folder.prompt', { parent })
      : t('entries.new-file.prompt', { parent }),
    '',
    t('common.create'),
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
    t('common.rename'),
    t('entries.rename.prompt', { name: oldName }),
    oldName,
    t('common.rename'),
  );
  if (name === null || name.trim() === '' || name === oldName) return;
  await renameTo(path, oldName, name);
}

/**
 * Переименовать в готовое имя — без вопроса об имени, но со всем прочим:
 * план ссылок до записи, вопрос, обновлять ли их, переезд вкладок.
 * Отсюда же переименовывает заголовок заметки (задача 129): путь один,
 * чтобы переименование из заголовка не разошлось с деревом.
 */
export async function renameTo(path: string, oldName: string, name: string): Promise<void> {
  try {
    // План спрашивается до переименования и ничего не меняет (Р-136).
    // Он же проверяет имя: отказ придёт здесь, а не после того, как файл
    // уже переехал.
    const plan = await ipc.planRename(path, name);
    // Пути вкладок переводятся в новый мир: план приходит с путями после
    // переименования, а вкладка внутри переименовываемой папки ещё лежит
    // по старому пути и иначе не совпала бы ни с чем.
    const busy = unsavedPaths().map((open) => movedPath(open, path, plan.target) ?? open);
    const split = splitPlan(plan.files, busy);

    let fixLinks = false;
    if (plan.files.length > 0) {
      const answer = await askChoice(t('entries.links.title'), describePlan(oldName, split), [
        { id: 'fix', label: t('entries.links.fix'), primary: true },
        { id: 'rename', label: t('entries.links.rename-only') },
        { id: 'cancel', label: t('common.cancel'), cancel: true },
      ]);
      if (answer === null || answer === 'cancel') return;
      fixLinks = answer === 'fix';
    }

    const moved = await ipc.renameEntry(path, name);
    await movedTabs(path, moved);
    await refreshDirs([parentOf(path)]);

    if (fixLinks && split.editable.length > 0) {
      await fixLinksOnDisk(split.editable);
    }
  } catch (error) {
    await report(error);
  }
}

/**
 * Применить правку ссылок и разобраться с последствиями.
 *
 * Перечитывание открытых вкладок — не мелочь: механизм внешних изменений
 * опрашивает диск при получении окном фокуса (Р-014), а во время нашей же
 * правки окно фокус не теряет. Без явного вызова чистая вкладка показывала бы
 * старый текст до следующего переключения в другое окно и обратно.
 */
async function fixLinksOnDisk(files: FileEdits[]): Promise<void> {
  const { problems } = await applyEdits(files);

  await checkExternalChanges();

  if (problems.length > 0) {
    await message(
      t('entries.links.problems', { problems: problems.join('\n') }),
      { title: 'ZeroNote', kind: 'warning' },
    );
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
  for (const tab of [...tabs.items]) {
    const path = tab.meta.path;
    if (path === null) continue;

    const target = movedPath(path, from, to);
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
    folder ? t('entries.delete.folder') : t('entries.delete.file'),
    folder ? t('entries.delete.folder.text', { name }) : t('entries.delete.file.text', { name }),
    [
      { id: 'cancel', label: t('common.cancel'), cancel: true, primary: true },
      { id: 'delete', label: t('entries.delete.confirm'), danger: true },
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
 *
 * **Кроме изменённых** (задача 136). У них в корзину ушла версия с диска,
 * а набранное есть только во вкладке, и закрытие стирало его вместе
 * с черновиком — хотя вопрос об удалении обещал «оттуда можно вернуть».
 * Такая вкладка остаётся, отвязанной от файла, как при «Оставить
 * в редакторе» для удалённого снаружи: закрыть её можно обычным путём,
 * и тогда вопрос про несохранённое будет честным.
 */
async function closeTabsUnder(path: string): Promise<void> {
  const prefix = `${path}\\`;

  for (const tab of [...tabs.items]) {
    const open = tab.meta.path;
    if (open === null || (open !== path && !open.startsWith(prefix))) continue;

    if (tab.meta.modified) {
      markChanged(await markDetached(tab.meta.id));
      continue;
    }
    await closeTabState(tab.meta.id);
  }
}
