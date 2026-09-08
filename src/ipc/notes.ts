import { invoke } from '@tauri-apps/api/core';

/**
 * Заметки, которые приложение создаёт само (задача 90).
 */

/** Ответ на «заметку на сегодня»: путь и была ли она создана сейчас. */
export interface DailyNote {
  path: string;
  created: boolean;
}

/**
 * Открыть заметку на сегодня, создав её при необходимости.
 *
 * Дата и время передаются окном: у ядра нет часового пояса. Существующая
 * заметка не переписывается — команда просто отдаёт её путь.
 */
export const openDailyNote = (date: string, time: string): Promise<DailyNote> =>
  invoke('open_daily_note', { date, time });
