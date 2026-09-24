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

/**
 * Цвета образца темы — восемь ролей, по которым тему узнают на глаз.
 *
 * Считает их ядро: подстановка палитры и донашивание недостающего живут там,
 * и вторая реализация здесь разошлась бы с первой.
 */
export interface ThemeSample {
  id: string;
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  border: string;
  keyword: string;
  string: string;
  comment: string;
}

/**
 * Образцы всех доступных тем.
 *
 * Отдельным вызовом, а не полем состояния оформления: состояние собирается
 * при каждом запуске, а образцы нужны одной вкладке.
 */
export function themeSamples(): Promise<ThemeSample[]> {
  return invoke<ThemeSample[]>('theme_samples');
}

/** Копия темы в папке пользователя. Возвращает описание новой темы. */
export function createTheme(id: string): Promise<ThemeInfo> {
  return invoke<ThemeInfo>('create_theme', { id });
}

/** Показать папку тем в проводнике. */
export function openThemesDir(): Promise<void> {
  return invoke('open_themes_dir');
}

/** Что не прошло проверку читаемости (Р-078, Р-143) — те же правила, что у теста встроенных тем. */
export interface Finding {
  kind: 'contrast' | 'distance' | 'unchecked';
  /** Токен, который проверяли: текст или первый из пары цветов. */
  token: string;
  /** Фон, на котором читали, или второй цвет пары. */
  against: string;
  /** Отношение контраста или расстояние в Lab. */
  value: number;
  need: number;
}

export interface PaletteEntry {
  key: string;
  /** Действующее значение: из файла темы, из встроенной пары или выведенное. */
  value: string;
  /** Задано в файле темы. */
  own: boolean;
  /** Выведено из других цветов палитры, а не задано. */
  derived: boolean;
}

export interface TokenEntry {
  /** Полное имя: `color-bg-canvas`. */
  name: string;
  /** Раздел файла темы: `color`. */
  section: string;
  /** Ключ в разделе: `bg-canvas`. */
  key: string;
  /** Значение слоя токенов при нынешней плотности, до темы. */
  default: string;
  /** Переопределение из файла темы. */
  own: string | null;
  /** Что стоит на экране. */
  resolved: string;
}

/** Тема для правки в редакторе тем (задача 105). */
export interface ThemeEditorState {
  id: string;
  name: string;
  appearance: Appearance;
  /** Встроенная не правится — правят свою копию. */
  builtin: boolean;
  path: string | null;
  palette: PaletteEntry[];
  tokens: TokenEntry[];
  findings: Finding[];
  /** Тема не собирается — почему. */
  problem: string | null;
}

export function themeEditor(id: string, density: Density): Promise<ThemeEditorState> {
  return invoke<ThemeEditorState>('theme_editor', { id, density });
}

/**
 * Записать одно значение в файл своей темы; `null` — убрать, вернув
 * умолчание. Правка, ломающая тему, отвергается словами.
 */
export function setThemeValue(
  id: string,
  section: string,
  key: string,
  value: string | null,
): Promise<void> {
  return invoke('set_theme_value', { id, section, key, value });
}
