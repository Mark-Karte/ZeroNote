import { notify } from '../state/notices.svelte';
import { t } from '../l10n';
import { activeTab, type Tab } from '../state/tabs.svelte';
import { cannotPrint } from './print';

/**
 * Экспорт для чужих глаз (задача 110).
 *
 * Здесь только решение «можно ли» — его спрашивают меню и палитра без
 * загрузки модуля экспорта. Сам экспорт и вывод HTML грузятся по команде.
 */

/**
 * Почему эту вкладку не экспортировать в HTML. `null` — можно.
 *
 * Экспортируется текст: заметка — документом, код — с раскраской.
 * Картинку и PDF отдают самим файлом — завернуть их в страницу значит
 * сделать пересылку тяжелее, а не проще.
 */
export function cannotExport(tab: Tab | null): string | null {
  if (!tab) return t('output.no-tab');
  switch (tab.meta.kind) {
    case 'text':
      return tab.meta.large ? t('export.large') : null;
    case 'image':
    case 'pdf':
      return t('export.binary');
    case 'settings':
      return t('output.settings');
  }
}

/**
 * Почему вкладку не экспортировать в PDF. `null` — можно.
 *
 * Правила те же, что у печати: PDF — это печать в файл. Картинку можно —
 * лист с ней отдают так же, как бумажный.
 */
export function cannotExportPdf(tab: Tab | null): string | null {
  return cannotPrint(tab);
}

type Exported = { path: string; problems: string[] } | null;

/** Общий ответ обоих экспортов: где файл и что не вошло. */
async function run(failed: (error: string) => string, work: () => Promise<Exported>): Promise<void> {
  try {
    const done = await work();
    if (done === null) return;
    const tail = done.problems.length > 0 ? ` ${done.problems.join('; ')}` : '';
    notify(t('export.saved', { path: done.path }) + tail);
  } catch (error) {
    // Слишком большой файл (`TooLarge`) говорит о себе сам.
    notify(failed(error instanceof Error ? error.message : String(error)));
  }
}

export async function exportHtmlActive(): Promise<void> {
  const tab = activeTab();
  const reason = cannotExport(tab);
  if (reason !== null || tab === null) {
    if (reason !== null) notify(reason);
    return;
  }

  await run(
    (error) => t('export.failed.html', { error }),
    async () => (await import('../export/html')).exportTabAsHtml(tab),
  );
}

export async function exportPdfActive(): Promise<void> {
  const tab = activeTab();
  const reason = cannotExportPdf(tab);
  if (reason !== null || tab === null) {
    if (reason !== null) notify(reason);
    return;
  }

  await run(
    (error) => t('export.failed.pdf', { error }),
    async () => (await import('../export/pdf')).exportTabAsPdf(tab),
  );
}
