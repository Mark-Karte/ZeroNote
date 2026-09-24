import { invoke } from '@tauri-apps/api/core';

/**
 * Экспорт для чужих глаз (задачи 110 и 111).
 *
 * Документ собирает окно, ядро только пишет — атомарно и только файлы
 * того вида, который экспорт и делает: путь проверяет ядро, а не окно.
 */

/** Записать экспортированный HTML. Путь — из диалога сохранения. */
export const writeHtmlExport = (path: string, html: string): Promise<void> =>
  invoke('write_html_export', { path, html });
