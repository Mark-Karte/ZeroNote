import { invoke } from '@tauri-apps/api/core';

/**
 * Версия рантайма WebView2 — из ядра, а не из строки агента.
 *
 * Строка агента сокращена самим Edge: младшие части номера в ней заменены
 * нулями. Ядро спрашивает саму систему и получает настоящий номер.
 */
export const webviewVersion = (): Promise<string | null> => invoke('webview_version');

/**
 * Путь к файлу уведомлений о сторонних компонентах рядом с программой.
 * `null` — файла нет. Путь до ресурсов сборки знает только ядро.
 */
export const thirdPartyNotices = (): Promise<string | null> => invoke('third_party_notices');
