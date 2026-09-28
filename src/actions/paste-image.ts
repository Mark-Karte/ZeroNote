import type { EditorView } from '@codemirror/view';

import { clipboardImage } from '../ipc/clipboard';
import { savePastedImage } from '../ipc/notes';
import { notify } from '../state/notices.svelte';
import { t } from '../l10n';
import { languageOf, tabById } from '../state/tabs.svelte';

/**
 * Картинка из буфера обмена в заметку (задача 146): файл PNG в папку
 * вложений, в текст — ссылка на него.
 *
 * Два входа. `Ctrl+V` приходит событием вставки, и картинку отдаёт вебвью
 * (`editor/image-paste.ts`). Пункт меню «Вставить» события не рождает,
 * и картинку читает ядро (Р-109) — как и тогда, когда вебвью её
 * не нашёл. Дальше путь один.
 */

/** Подпись файла PNG. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return PNG.every((byte, at) => bytes[at] === byte);
}

/**
 * Отметка времени для имени файла, как у Obsidian: `20260928143012`.
 * Местное время — «когда вставил» человек, а не UTC; поэтому её
 * и считает окно, а не ядро.
 */
export function stamp(date: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}` +
    `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  );
}

/**
 * Картинка в PNG.
 *
 * Ядро сжимать PNG не умеет — библиотеки для этого в сборке нет, — а вебвью
 * умеет: картинка раскодируется и рисуется на холсте, холст отдаёт PNG.
 * Так приходит растр BMP из ядра и всё, что вебвью отдал не в PNG.
 */
async function toPng(bytes: Uint8Array, type: string): Promise<Uint8Array> {
  if (isPng(bytes)) return bytes;
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    // Не для глаз: ошибку ловит `pasteImage` и говорит своими словами.
    if (!context) throw new Error('canvas has no 2d context');
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/** Картинка из буфера через ядро. `null` — её там нет или буфер не прочитался. */
async function fromClipboard(): Promise<Uint8Array | null> {
  try {
    const bytes = new Uint8Array(await clipboardImage());
    return bytes.length > 0 ? bytes : null;
  } catch (error) {
    notify(t('image-paste.clipboard.failed', { error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

/**
 * Вставить картинку в заметку вкладки `tabId`, в представление `view`.
 *
 * `file` — картинка из события вставки; `null` — искать её в буфере ядром.
 * Нет картинки и там — вставлять нечего, и сказать тоже нечего: так же
 * молча `Ctrl+V` обходится с пустым буфером.
 */
export async function pasteImage(tabId: number, view: EditorView, file: File | null): Promise<void> {
  const bytes = file ? new Uint8Array(await file.arrayBuffer()) : await fromClipboard();
  if (bytes === null) return;
  const type = file?.type ?? 'image/bmp';

  const tab = tabById(tabId);
  if (!tab) return;
  if (languageOf(tab)?.id !== 'markdown') {
    notify(t('image-paste.not-markdown'));
    return;
  }
  const note = tab.meta.path;
  if (note === null) {
    notify(t('image-paste.unsaved'));
    return;
  }

  let png: Uint8Array;
  try {
    png = await toPng(bytes, type);
  } catch {
    notify(t('image-paste.unreadable'));
    return;
  }

  let link: string;
  try {
    ({ link } = await savePastedImage(note, stamp(new Date()), png));
  } catch (error) {
    notify(t('image-paste.failed', { error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  // Пока файл писался, вкладку могли закрыть: файл уже лежит в папке,
  // а вписать ссылку некуда — сказать, где он.
  if (!view.dom.isConnected || view.state.readOnly) {
    notify(t('image-paste.closed', { link }));
    return;
  }
  view.dispatch({
    ...view.state.replaceSelection(link),
    scrollIntoView: true,
    userEvent: 'input.paste',
  });
}
