import { invoke } from '@tauri-apps/api/core';

/**
 * Чтение буфера обмена — через ядро.
 *
 * Не потому, что так «правильнее», а потому что иначе нельзя: браузерное
 * `navigator.clipboard.readText()` в нашем WebView2 не отвечает вовсе,
 * обещание не разрешается и не отвергается (Р-109). Запись при этом
 * браузерная и работает.
 */
export const clipboardText = (): Promise<string> => invoke('clipboard_text');

/**
 * Картинка из буфера обмена — для «Вставить» в заметку (задача 146).
 *
 * Байты файла PNG или растра BMP; пусто — картинки в буфере нет. PNG
 * из BMP делает окно (`actions/paste-image.ts`): в ядре сжать нечем.
 */
export const clipboardImage = (): Promise<ArrayBuffer> => invoke('clipboard_image');
