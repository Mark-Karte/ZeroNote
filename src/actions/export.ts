import { notify } from '../state/notices.svelte';
import { activeTab, type Tab } from '../state/tabs.svelte';

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
  if (!tab) return 'Нет открытой вкладки';
  switch (tab.meta.kind) {
    case 'text':
      return tab.meta.large ? 'Файл открыт в упрощённом режиме — экспорт для него не собирается' : null;
    case 'image':
    case 'pdf':
      return 'Картинку и PDF отдают самим файлом — страница вокруг них ничего не добавит';
    case 'settings':
      return 'Параметры — страница приложения, а не документ';
  }
}

export async function exportHtmlActive(): Promise<void> {
  const tab = activeTab();
  const reason = cannotExport(tab);
  if (reason !== null || tab === null) {
    if (reason !== null) notify(reason);
    return;
  }

  try {
    const { exportTabAsHtml } = await import('../export/html');
    const done = await exportTabAsHtml(tab);
    if (done === null) return;
    const tail = done.problems.length > 0 ? ` ${done.problems.join('; ')}` : '';
    notify(`Сохранено: ${done.path}.${tail}`);
  } catch (error) {
    // Слишком большой файл (`TooLarge`) говорит о себе сам.
    notify(`Экспорт не удался: ${error instanceof Error ? error.message : String(error)}`);
  }
}
