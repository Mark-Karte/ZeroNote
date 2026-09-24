import { notify } from '../state/notices.svelte';
import { activeTab, type Tab } from '../state/tabs.svelte';

/**
 * Команда «Печать…» (задача 109).
 *
 * Здесь только решение «можно ли» — оно нужно меню и панели сразу,
 * без загрузки модуля печати. Сама печать (`print/print.ts`) и вывод HTML
 * грузятся по требованию: в стартовый кусок они не едут.
 */

/**
 * Почему эту вкладку не напечатать. `null` — можно.
 *
 * PDF печатает своя программа: pdf.js рисует страницу картинкой, и печать
 * через него — отдельная работа ради того, что лучше делает просмотрщик
 * PDF. Параметры — страница приложения, а не документ. Файл в упрощённом
 * режиме (свыше 50 МиБ) — не для бумаги.
 */
export function cannotPrint(tab: Tab | null): string | null {
  if (!tab) return 'Нет открытой вкладки';
  switch (tab.meta.kind) {
    case 'pdf':
      return 'PDF печатается своей программой: «Показать в проводнике», открыть и напечатать там';
    case 'settings':
      return 'Параметры — страница приложения, а не документ';
    case 'image':
      return null;
    case 'text':
      return tab.meta.large ? 'Файл открыт в упрощённом режиме — печать для него не собирается' : null;
  }
}

export async function printActive(): Promise<void> {
  const tab = activeTab();
  const reason = cannotPrint(tab);
  if (reason !== null || tab === null) {
    // Ответ словами, а не молчание: из палитры команду зовут и над PDF.
    if (reason !== null) notify(reason);
    return;
  }

  try {
    const { printTab } = await import('../print/print');
    const problems = await printTab(tab);
    if (problems.length > 0) notify(`Печать: ${problems.join('; ')}`);
  } catch (error) {
    // Слишком большой файл (`TooLarge`) говорит о себе сам.
    notify(`Печать не собралась: ${error instanceof Error ? error.message : String(error)}`);
  }
}
