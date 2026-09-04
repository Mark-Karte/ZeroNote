import { message } from '@tauri-apps/plugin-dialog';
import { check } from '@tauri-apps/plugin-updater';

import { askChoice } from '../state/modal.svelte';
import { version } from '../version';

/**
 * Обновление из GitHub.
 *
 * Единственное место во всём приложении, где открывается сетевое соединение,
 * и открывается оно только по нажатию (Р-118). Ни фоновой проверки, ни
 * расписания: приложение, которое ходит в сеть само, обязано об этом
 * спрашивать, а мы обошлись без вопроса, обойдясь без хождения.
 *
 * Запрос делает ядро, а не вебвью: плагин обновлений работает на стороне
 * Rust. Поэтому политика безопасности окна остаётся прежней — вебвью
 * по-прежнему не открывает ни одного соединения.
 *
 * Между «нашлась новая версия» и «ставим» стоит человек: сначала вопрос
 * с номером версии и описанием, и только по второму нажатию — загрузка.
 */

export const updates = $state<{ busy: boolean }>({ busy: false });

async function report(text: string): Promise<void> {
  await message(text, { title: 'ZeroNote', kind: 'error' });
}

/**
 * Проверить, есть ли новая версия, и предложить её поставить.
 *
 * Подпись проверяет плагин: пакет, подписанный не нашим ключом, до установки
 * не доходит. Это не тот сертификат, которого у нас нет по Р-007, —
 * у обновлений своя пара ключей, и открытая половина вшита в приложение.
 */
export async function checkForUpdates(): Promise<void> {
  if (updates.busy) return;
  updates.busy = true;

  try {
    const found = await check();

    if (!found) {
      await askChoice('Обновлений нет', `У вас последняя версия — ${version}.`, [
        { id: 'ok', label: 'Хорошо', primary: true, cancel: true },
      ]);
      return;
    }

    const notes = found.body?.trim();
    const answer = await askChoice(
      'Есть новая версия',
      `Вышла ${found.version}, у вас ${version}.` +
        (notes ? `\n\n${notes}` : '') +
        '\n\nЗагрузка займёт несколько секунд. Приложение закроется, ' +
        'поставит обновление и откроется снова.',
      [
        { id: 'later', label: 'Не сейчас', cancel: true, primary: true },
        { id: 'install', label: 'Установить' },
      ],
    );

    if (answer !== 'install') return;

    // Дальше приложение заменяет само себя: установщик запускается, окно
    // закрывается, и возвращаться сюда уже некуда.
    await found.downloadAndInstall();
  } catch (error) {
    await report(
      'Не удалось проверить обновления.\n\n' +
        `${String(error)}\n\n` +
        'Проверьте подключение к сети. Ничего не установлено.',
    );
  } finally {
    updates.busy = false;
  }
}
