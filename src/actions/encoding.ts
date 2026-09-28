import { message } from '@tauri-apps/plugin-dialog';
import * as ipc from '../ipc/files';
import type { EncodingId, LineEnding } from '../ipc/files';
import { markChanged, replaceContent, tabById, contentOf } from '../state/tabs.svelte';
import { askChoice } from '../state/modal.svelte';
import { t } from '../l10n';

/**
 * Две разные операции со сменой кодировки.
 *
 * В Notepad++ это разные пункты меню, и путать их нельзя:
 *
 * * **Интерпретировать как** — перечитать те же байты другой кодировкой.
 *   Лечит крякозябры. Файл не меняется, буфер остаётся чистым.
 * * **Преобразовать в** — оставить текст, сменить кодировку записи.
 *   Меняет файл, буфер становится изменённым.
 */

async function report(error: unknown): Promise<void> {
  await message(String(error), { title: 'ZeroNote', kind: 'error' });
}

export async function reinterpretAs(id: number, encoding: EncodingId): Promise<void> {
  const tab = tabById(id);
  if (!tab) return;

  // Перечитывание берёт байты с диска, а значит стирает несделанные правки.
  // Спрашиваем прямо, а не «на всякий случай сохраняем».
  if (tab.meta.modified) {
    const answer = await askChoice(
      t('encoding.reread.title'),
      t('encoding.reread.text'),
      [
        // По умолчанию — отмена, а не перечитывание: Enter, нажатый не глядя,
        // не должен стирать набранное. Раньше здесь по умолчанию стояло
        // именно перечитывание.
        { id: 'cancel', label: t('common.cancel'), cancel: true, primary: true },
        { id: 'discard', label: t('encoding.reread.discard'), danger: true },
      ],
    );
    if (answer !== 'discard') return;
  }

  try {
    replaceContent(await ipc.reinterpretEncoding(id, encoding));
  } catch (error) {
    await report(error);
  }
}

export async function convertTo(id: number, encoding: EncodingId): Promise<void> {
  const tab = tabById(id);
  if (!tab?.editor) return;

  try {
    // Ядро проверяет переводимость текста до того, как что-либо менять:
    // узнать о непереводимом символе при сохранении было бы поздно.
    // Текст тот же, а файл станет другим: признак держится до сохранения,
    // что бы ни стало с текстом (задача 136).
    markChanged(await ipc.convertEncoding(id, encoding, contentOf(tab.editor)));
  } catch (error) {
    await report(error);
  }
}

export async function setBom(id: number, bom: boolean): Promise<void> {
  try {
    markChanged(await ipc.setBom(id, bom));
  } catch (error) {
    await report(error);
  }
}

export async function setLineEnding(id: number, eol: LineEnding): Promise<void> {
  try {
    markChanged(await ipc.setLineEnding(id, eol));
  } catch (error) {
    await report(error);
  }
}

function eolName(eol: LineEnding): string {
  switch (eol) {
    case 'cr-lf':
      return 'CRLF (Windows)';
    case 'lf':
      return 'LF (Unix)';
    default:
      return t('eol.cr');
  }
}

/**
 * Вопрос перед первым сохранением файла со смешанными переносами.
 *
 * Внутри буфера все переносы одинаковы, поэтому записать такой файл обратно
 * байт в байт после правки невозможно. Молча привести его к преобладающему
 * типу нельзя — это нормализация каждой строки без команды пользователя,
 * то есть нарушение инварианта 1. См. решение Р-018.
 *
 * Возвращает `false`, если пользователь передумал сохранять.
 */
export async function resolveMixedLineEndings(id: number): Promise<boolean> {
  const tab = tabById(id);
  if (!tab || !tab.meta.eolMixed) return true;

  const dominant = tab.meta.eol;
  const others = (['cr-lf', 'lf', 'cr'] as LineEnding[]).filter((e) => e !== dominant);

  const answer = await askChoice(
    t('eol.mixed.title'),
    t('eol.mixed.text', { file: tab.meta.title }),
    [
      { id: 'cancel', label: t('files.unsaved.discard'), cancel: true },
      ...others.map((eol) => ({ id: eol, label: eolName(eol) })),
      { id: dominant, label: t('eol.dominant', { eol: eolName(dominant) }), primary: true },
    ],
  );

  if (!answer || answer === 'cancel') return false;

  await setLineEnding(id, answer as LineEnding);
  return true;
}
