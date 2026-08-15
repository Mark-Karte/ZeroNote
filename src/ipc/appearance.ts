import { invoke } from '@tauri-apps/api/core';

export type Appearance = 'light' | 'dark';
export type Density = 'normal' | 'compact';

export interface ThemeInfo {
  id: string;
  name: string;
  appearance: Appearance;
  /** Встроенная тема, файла на диске нет. */
  builtin: boolean;
}

export interface AppearanceState {
  /** Имя токена без префикса `--zn-` → значение CSS. */
  tokens: Record<string, string>;
  themeId: string;
  themeName: string;
  appearance: Appearance;
  density: Density;
  themes: ThemeInfo[];
  /** Где лежат данные приложения. */
  dataDir: string;
  /** `false` — папка рядом с приложением недоступна, работаем из запасной. */
  portable: boolean;
  /** Проблемы, которые надо показать пользователю. Пустой массив — всё хорошо. */
  problems: string[];
}

/**
 * Системную настройку оформления узнаём в вебвью через prefers-color-scheme
 * и передаём в ядро: так не нужно спрашивать Windows из Rust и следить за
 * оповещениями об её изменении вручную.
 */
export function fetchAppearance(systemDark: boolean): Promise<AppearanceState> {
  return invoke<AppearanceState>('appearance_state', { systemDark });
}

/** Исходник встроенной темы — чтобы взять её за основу для своей. */
export function builtinThemeSource(appearance: Appearance): Promise<string> {
  return invoke<string>('builtin_theme_source', { appearance });
}
