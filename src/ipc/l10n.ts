import { invoke } from '@tauri-apps/api/core';
import type { Table } from '../l10n';

/**
 * Язык окна, выбранный ядром при старте (задачи 152 и 153): код, встроенная
 * таблица, на которую опереться (окно грузит её само), и свой перевод из
 * папки данных — уже проверенный ядром, одни годные строки.
 */
export interface WindowLanguage {
  code: string;
  builtin: string | null;
  table: Table | null;
  /** Первый день недели по региону Windows: 0 — понедельник, 6 — воскресенье. */
  weekStart: number;
}

export function windowLanguage(): Promise<WindowLanguage> {
  return invoke<WindowLanguage>('language');
}

/** Язык в списке окна параметров. */
export interface LanguageInfo {
  code: string;
  /** Есть встроенная таблица этого кода. */
  builtin: boolean;
  /** Есть свой файл этого кода в папке переводов. */
  file: boolean;
  /** Сколько строк английской таблицы есть в своём файле, в процентах. */
  coverage: number;
}

export interface LanguagesState {
  languages: LanguageInfo[];
  /** Какой язык выбрал бы `auto`. */
  auto: string;
  /** На каком языке окно говорит сейчас. */
  current: string;
  /** Папка своих переводов. */
  dir: string;
}

export function languages(): Promise<LanguagesState> {
  return invoke<LanguagesState>('languages');
}

/** Завести свой перевод; вернуть путь нового файла. Существующий — отказ. */
export function createTranslation(code: string): Promise<string> {
  return invoke<string>('create_translation', { code });
}

export function openTranslationsDir(): Promise<void> {
  return invoke('open_translations_dir');
}

/** Перезапустить приложение. Черновики и сессию сбросить до вызова. */
export function restartApp(): Promise<void> {
  return invoke('restart');
}
