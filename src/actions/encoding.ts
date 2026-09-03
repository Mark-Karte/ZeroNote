import { message } from '@tauri-apps/plugin-dialog';
import * as ipc from '../ipc/files';
import type { EncodingId, LineEnding } from '../ipc/files';
import { applyMeta, replaceContent, tabById, textOf } from '../state/tabs.svelte';
import { askChoice } from '../state/modal.svelte';

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
      'Перечитать файл другой кодировкой?',
      'В буфере есть несохранённые изменения. Перечитывание возьмёт байты с диска, и правки пропадут.',
      [
        // По умолчанию — отмена, а не перечитывание: Enter, нажатый не глядя,
        // не должен стирать набранное. Раньше здесь по умолчанию стояло
        // именно перечитывание.
        { id: 'cancel', label: 'Отмена', cancel: true, primary: true },
        { id: 'discard', label: 'Перечитать и потерять правки', danger: true },
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
  if (!tab) return;

  try {
    // Ядро проверяет переводимость текста до того, как что-либо менять:
    // узнать о непереводимом символе при сохранении было бы поздно.
    applyMeta(await ipc.convertEncoding(id, encoding, textOf(tab)));
  } catch (error) {
    await report(error);
  }
}

export async function setBom(id: number, bom: boolean): Promise<void> {
  try {
    applyMeta(await ipc.setBom(id, bom));
  } catch (error) {
    await report(error);
  }
}

export async function setLineEnding(id: number, eol: LineEnding): Promise<void> {
  try {
    applyMeta(await ipc.setLineEnding(id, eol));
  } catch (error) {
    await report(error);
  }
}

const EOL_NAMES: Record<LineEnding, string> = {
  'cr-lf': 'CRLF (Windows)',
  lf: 'LF (Unix)',
  cr: 'CR (классический Mac)',
};

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
    'В файле разные переносы строк',
    `Файл «${tab.meta.title}» содержит переносы нескольких типов. ` +
      'Сохранить его без изменений уже нельзя: внутри редактора все переносы одинаковы.\n\n' +
      'Выберите, к какому типу привести файл целиком.',
    [
      { id: 'cancel', label: 'Не сохранять', cancel: true },
      ...others.map((eol) => ({ id: eol, label: EOL_NAMES[eol] })),
      { id: dominant, label: `${EOL_NAMES[dominant]} — преобладает`, primary: true },
    ],
  );

  if (!answer || answer === 'cancel') return false;

  await setLineEnding(id, answer as LineEnding);
  return true;
}
