import { aboutText } from '../about';
import { webviewVersion } from '../ipc/about';
import { askChoice } from '../state/modal.svelte';
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

  const answer = await askChoice('О программе', text, [
    { id: 'copy', label: 'Скопировать' },
    { id: 'close', label: 'Закрыть', primary: true, cancel: true },
  ]);

  if (answer === 'copy') await copyText(text);
}
