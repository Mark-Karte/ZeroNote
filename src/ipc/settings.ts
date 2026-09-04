import { invoke } from '@tauri-apps/api/core';

/**
 * Значения настроек в том виде, в каком они лежат в файле.
 *
 * Имена ключей не приводятся к camelCase намеренно: та же структура читает
 * `settings.toml`, и `light_theme` — это имя ключа в файле пользователя.
 * Переименуй мы его для фронтенда — пришлось бы держать два имени одному
 * и тому же и помнить, какое где.
 */
export interface Settings {
  schema: number;
  appearance: {
    theme: string;
    light_theme: string;
    dark_theme: string;
    density: 'normal' | 'compact';
  };
  font: {
    ui: {
      family: string | null;
      size: number | null;
    };
  };
  editor: {
    wrap: boolean;
    auto_close: boolean;
    indent_style: 'spaces' | 'tabs';
    indent_width: number;
    invisibles: boolean;
    markdown_bar: boolean;
    link_suggest: boolean;
  };
}

export interface SettingsState {
  settings: Settings;
  /** Путь к `settings.toml`: окно параметров показывает его и умеет открыть. */
  path: string;
  /** Файл не разбирается — править нельзя, можно только смотреть. */
  broken: string | null;
}

export const settingsState = (): Promise<SettingsState> => invoke('settings_state');

/** Записать одну настройку. `null` — убрать ключ, то есть «брать из темы». */
export const updateSetting = (
  path: string[],
  value: string | number | boolean | null,
): Promise<void> => invoke('update_setting', { path, value });
