import * as ipc from '../ipc/l10n';
import { t } from '../l10n';
import { askInput } from '../state/modal.svelte';
import { notify } from '../state/notices.svelte';
import { flushNow } from '../state/persist.svelte';

/**
 * Язык окна и свои переводы (задача 153, Р-315).
 */

/**
 * Перезапустить приложение — язык меняется только так.
 *
 * Сначала черновики и сессия — на диск, сейчас, не дожидаясь таймера:
 * после перезапуска всё поднимается, как после сбоя (инвариант 4), поэтому
 * вопросов о несохранённом не нужно — ничего не теряется.
 */
export async function restartApp(): Promise<void> {
  await flushNow();
  try {
    await ipc.restartApp();
  } catch (error) {
    notify(String(error));
  }
}

/**
 * Завести свой перевод: спросить код языка, создать файл копией таблицы
 * и показать его в проводнике. Вернуть `true`, если файл создан.
 */
export async function createTranslation(): Promise<boolean> {
  const code = await askInput(
    t('translation.create.title'),
    t('translation.create.text'),
    '',
    t('translation.create.confirm'),
  );
  if (code === null || code.trim() === '') return false;
  try {
    const path = await ipc.createTranslation(code);
    notify(t('translation.created', { file: path.split(/[\\/]/).pop() ?? path }));
    return true;
  } catch (error) {
    notify(String(error));
    return false;
  }
}

export async function openTranslationsDir(): Promise<void> {
  try {
    await ipc.openTranslationsDir();
  } catch (error) {
    notify(String(error));
  }
}
