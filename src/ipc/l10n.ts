import { invoke } from '@tauri-apps/api/core';

/** Язык окна, выбранный ядром при старте: `ru`, `en` (задача 152). */
export function languageCode(): Promise<string> {
  return invoke<string>('language');
}
