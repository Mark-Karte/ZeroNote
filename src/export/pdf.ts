import { save as saveDialog } from '@tauri-apps/plugin-dialog';

import { documentFor, isMarkdownTab, pageTitle } from '../html/tab';
import { exportPdf } from '../ipc/export';
import { mountDocument } from '../print/print';
import type { Tab } from '../state/tabs.svelte';

/**
 * «Экспорт в PDF» одной командой (задача 111).
 *
 * Документ тот же, что у печати: вывод HTML в светлой теме, поставленный
 * в окно контейнером. Печатает его тот же движок WebView2, только не через
 * диалог, а из ядра — со своими колонтитулами: в шапке имя файла,
 * в подвале номер страницы, адреса страницы приложения нет (Р-271).
 *
 * Модуль грузится по команде, как печать и экспорт в HTML.
 */

/**
 * Куда предложить сохранить: рядом с файлом, под его именем. Заметка
 * теряет `.md` — «План.pdf»; код расширение сохраняет — «main.rs.pdf».
 */
export function pdfPath(path: string | null, title: string, markdown: boolean): string {
  const base = path ?? title;
  const stem = markdown ? base.replace(/\.(md|markdown|mdx)$/i, '') : base;
  return `${stem}.pdf`;
}

/**
 * Экспортировать вкладку в PDF. `null` — человек закрыл диалог.
 *
 * Документ собирается до диалога — как у экспорта в HTML: слишком большая
 * заметка получает отказ раньше, чем выбрано место. В окно он ставится
 * после: пока открыт диалог, держать в окне лишний контейнер незачем.
 */
export async function exportTabAsPdf(
  tab: Tab,
): Promise<{ path: string; problems: string[] } | null> {
  const markdown = isMarkdownTab(tab);
  const built = await documentFor(tab);

  const target = await saveDialog({
    defaultPath: pdfPath(tab.meta.path, tab.meta.title, markdown),
    filters: [{ name: 'Документ PDF', extensions: ['pdf'] }],
  });
  if (!target) return null;

  const mounted = await mountDocument(built.html);
  try {
    await exportPdf(target, pageTitle(tab.meta.title, markdown));
  } finally {
    mounted.unmount();
  }

  return { path: target, problems: [...mounted.problems, ...built.problems] };
}
