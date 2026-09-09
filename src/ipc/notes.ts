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

/**
 * За какие дни месяца заметки уже написаны (задача 97).
 *
 * Месяц — `ГГГГ-ММ`, ответ — номера дней. Месяц считает окно: у ядра нет
 * часового пояса, как и с датой заметки на сегодня.
 */
export const dailyNotesOfMonth = (month: string): Promise<number[]> =>
  invoke('daily_notes_of_month', { month });

/** Заготовка: имя для списка и путь для чтения (задача 95). */
export interface Template {
  name: string;
  path: string;
}

/**
 * Что лежит в папке заготовок.
 *
 * Папка не задана или пуста — пустой список, а не ошибка: «шаблонов нет» —
 * обычное состояние.
 */
export const listTemplates = (): Promise<Template[]> => invoke('list_templates');

/**
 * Прочитать заготовку, подставив дату, время и заголовок.
 *
 * Дату и время приносит окно — по той же причине, что у заметки на сегодня.
 * Путь ядро проверяет по папке шаблонов: команда читает файл с диска,
 * и брать путь на веру нельзя.
 */
export const readTemplate = (
  path: string,
  date: string,
  time: string,
  title: string,
): Promise<string> => invoke('read_template', { path, date, time, title });

/** Создать заметку с готовым содержимым. Существующий файл не переписывается. */
export const createNoteFromText = (
  folder: string,
  name: string,
  text: string,
): Promise<string> => invoke('create_note_from_text', { folder, name, text });
