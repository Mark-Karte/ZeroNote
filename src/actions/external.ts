import * as ipc from '../ipc/files';
import { applyMeta, replaceContent, resetBaseline, tabById, close } from '../state/tabs.svelte';
import { askChoice } from '../state/modal.svelte';
import { forgetDraft } from '../state/persist.svelte';

/**
 * Отслеживание изменений файла снаружи.
 *
 * Опрос при получении окном фокуса, а не подписка на события файловой системы
 * (решение Р-014): именно в этот момент пользователь мог что-то сделать с
 * файлом в другой программе, и именно тогда стоит спросить.
 *
 * Правила простые и разные для чистого и изменённого буфера:
 *
 * * **Буфер чист** — перечитываем молча. Терять нечего, а спрашивать о том,
 *   что не имеет последствий, — раздражать без пользы.
 * * **Буфер изменён** — спрашиваем. Здесь есть что терять с обеих сторон.
 * * **Файл исчез** — спрашиваем всегда: закрыть вкладку или оставить
 *   содержимое, чтобы записать его обратно.
 */

/**
 * Проверка идёт по одному вопросу за раз.
 *
 * Без этого возврат в окно с тремя изменившимися файлами открыл бы три
 * диалога сразу — точнее, два из них потерялись бы, потому что модальное
 * окно у нас одно.
 */
let running = false;

async function onModified(id: number): Promise<void> {
  const tab = tabById(id);
  if (!tab) return;

  if (!tab.meta.modified) {
    // Чистый буфер: перечитываем молча.
    replaceContent(await ipc.reloadBuffer(id));
    return;
  }

  const answer = await askChoice(
    'Файл изменён снаружи',
    `Файл «${tab.meta.title}» изменила другая программа, а в редакторе есть ` +
      'несохранённые правки.\n\nЧто оставить?',
    [
      { id: 'mine', label: 'Мои правки', primary: true },
      { id: 'disk', label: 'Версию с диска', danger: true },
    ],
  );

  if (answer === 'disk') {
    replaceContent(await ipc.reloadBuffer(id));
    await forgetDraft(id);
    return;
  }

  // Оставляем свои правки. Состояние файла принимается как эталонное, иначе
  // вопрос повторялся бы при каждом возврате в окно.
  applyMeta(await ipc.acceptExternal(id));
}

async function onRemoved(id: number): Promise<void> {
  const tab = tabById(id);
  if (!tab) return;

  const answer = await askChoice(
    'Файл исчез',
    `Файла «${tab.meta.title}» больше нет на диске: удалён, переименован ` +
      'или стал недоступен.\n\nСодержимое пока цело в редакторе.',
    [
      { id: 'close', label: 'Закрыть вкладку' },
      { id: 'keep', label: 'Оставить в редакторе', primary: true },
    ],
  );

  if (answer === 'close') {
    await close(id);
    return;
  }

  // Путь остаётся: по нему буфер и запишется обратно при сохранении.
  applyMeta(await ipc.markDetached(id));
}

/**
 * Сверить все открытые файлы с диском и разобраться с расхождениями.
 *
 * Вызывается при получении окном фокуса и перед выходом из приложения.
 */
export async function checkExternalChanges(): Promise<void> {
  if (running) return;
  running = true;

  try {
    for (const change of await ipc.checkExternal()) {
      if (change.status === 'modified') {
        await onModified(change.id);
      } else {
        await onRemoved(change.id);
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Файл изменился между чтением и сохранением.
 *
 * Отдельный случай: пользователь мог править файл в другой программе прямо
 * сейчас, и вопрос про фокус ещё не успел прозвучать. Перезаписывать молча
 * нельзя — это стёрло бы чужую работу.
 *
 * Возвращает `true`, если пользователь разрешил перезапись.
 */
export async function confirmOverwrite(id: number): Promise<boolean> {
  const tab = tabById(id);
  if (!tab) return false;

  const answer = await askChoice(
    'Файл изменился на диске',
    `Файл «${tab.meta.title}» изменила другая программа уже после того, как ` +
      'редактор его прочитал.\n\nСохранение затрёт эти изменения.',
    [
      { id: 'cancel', label: 'Не сохранять', cancel: true },
      { id: 'overwrite', label: 'Перезаписать' },
    ],
  );

  return answer === 'overwrite';
}

/** Перечитать активный буфер с диска, отказавшись от правок. */
export async function reloadFromDisk(id: number): Promise<void> {
  replaceContent(await ipc.reloadBuffer(id));
  resetBaseline(id);
  await forgetDraft(id);
}
