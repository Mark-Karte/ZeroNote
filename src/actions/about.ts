import { aboutText } from '../about';
import { thirdPartyNotices, webviewVersion } from '../ipc/about';
import { askChoice } from '../state/modal.svelte';
import { notify } from '../state/notices.svelte';
import { t } from '../l10n';
import { openPath } from '../state/tabs.svelte';
import { copyText } from './clipboard';

/**
 * «О программе»: что у меня установлено.
 *
 * Своего компонента у диалога нет — он собран из того же модального вопроса,
 * что и остальные. Заводить ради двух строк текста отдельное окно значило бы
 * завести и второе место, где надо помнить про темы, фокус и Escape.
 */

/** Сведения о текущей установке — строкой, как они уйдут в буфер обмена. */
export async function aboutSummary(): Promise<string> {
  let shell: string | null = null;
  try {
    shell = await webviewVersion();
  } catch {
    // Молчим намеренно: неизвестную версию оболочки строки уже умеют
    // называть неизвестной, а окно с ошибкой на нажатие «о программе» —
    // наказание не по делу.
  }
  return aboutText(shell);
}

/**
 * Показать сведения и предложить их скопировать.
 *
 * Копирование здесь не украшение: тридцати пяти тестировщикам версию
 * приходится называть в переписке, и «кажется, последняя» — не ответ.
 */
export async function showAbout(): Promise<void> {
  const text = await aboutSummary();

  const answer = await askChoice(t('about.title'), text, [
    { id: 'copy', label: t('about.copy') },
    { id: 'licenses', label: t('about.licenses') },
    { id: 'close', label: t('common.close'), primary: true, cancel: true },
  ]);

  if (answer === 'copy') await copyText(text);
  if (answer === 'licenses') await showLicenses();
}

/**
 * Уведомления о сторонних компонентах — файлом рядом с программой,
 * обычной вкладкой (приёмка этапа 17). Их лицензии требуют приложить
 * тексты к копии программы; здесь человек их и находит.
 */
async function showLicenses(): Promise<void> {
  try {
    const path = await thirdPartyNotices();
    if (path === null) {
      notify(t('about.licenses.missing'));
      return;
    }
    await openPath(path);
  } catch (error) {
    notify(t('about.licenses.failed', { error: error instanceof Error ? error.message : String(error) }));
  }
}
