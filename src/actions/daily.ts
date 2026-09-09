import { message } from '@tauri-apps/plugin-dialog';

import { openDailyNote } from '../ipc/notes';
import { openDropped } from './files';
import { refreshDirs } from '../state/tree.svelte';

/**
 * Заметка на сегодня (задача 90).
 *
 * **Дату и время считает окно, а не ядро.** У ядра нет часового пояса:
 * `std::time` знает секунды с начала эпохи, а какой сейчас день у человека —
 * не знает. Спрашивать об этом систему через FFI ради одной строки дороже,
 * чем взять дату там, где она и так есть. Ядро при этом дате не верит
 * и проверяет её вид: из даты складывается имя файла.
 */

/** Дата и время в том виде, в каком их ждёт ядро. */
export function stamp(now: Date): { date: string; time: string } {
  const pad = (value: number): string => String(value).padStart(2, '0');

  // Именно местные `getFullYear`/`getMonth`, а не `toISOString`: последний
  // отдаёт UTC, и после девяти вечера по Москве «сегодня» превращалось бы
  // в завтра — то есть заметка открывалась бы не та.
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

/** Папка, в которой лежит файл. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf('\\');
  return cut > 0 ? path.slice(0, cut) : path;
}

/**
 * Открыть заметку на сегодня, создав её при необходимости.
 *
 * Существующая заметка открывается как есть — за день команду нажимают
 * много раз, и второе нажатие обязано показать написанное утром.
 */
export async function openDaily(day?: string): Promise<void> {
  // День приходит из календаря (задача 97), время — всегда текущее: в
  // `{{time}}` шаблона имеет смысл только час, когда заметку завели.
  const now = stamp(new Date());
  const date = day ?? now.date;
  const time = now.time;

  try {
    const note = await openDailyNote(date, time);
    await openDropped([note.path]);

    // Созданный файл виден в дереве сразу, а не после следующего обхода:
    // папка может быть внутри открытого проекта, и человек ждёт её там.
    if (note.created) await refreshDirs([parentOf(note.path)]);
  } catch (error) {
    await message(String(error), { title: 'ZeroNote', kind: 'error' });
  }
}
