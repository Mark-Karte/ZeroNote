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
