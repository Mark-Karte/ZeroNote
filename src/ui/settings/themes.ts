import type { ThemeInfo } from '../../ipc/appearance';

/**
 * Правила вкладки «Темы»: что делает щелчок по карточке и чем она помечена.
 *
 * Вынесено из компонента, потому что правил ровно два и оба неочевидны:
 * щелчок значит разное при «Как в Windows» и без него, а пометок на карточке
 * может быть сразу две — «применена сейчас» и «светлая пара».
 */

/** Настройки тем, как они лежат в `settings.toml`. */
export interface ThemeSelection {
  /** Идентификатор темы или `system` — следовать оформлению Windows. */
  theme: string;
  lightTheme: string;
  darkTheme: string;
  /** Тема, применённая сейчас; при `system` — одна из пары. */
  currentId: string;
}

/** Ключ настройки и значение, которые запишет щелчок по карточке. */
export interface ThemeChoice {
  key: 'theme' | 'light_theme' | 'dark_theme';
  value: string;
}

/** Пометки карточки. Их может быть две сразу. */
export interface ThemeState {
  /** Эта тема применена прямо сейчас. */
  current: boolean;
  /** Роль в паре при «Как в Windows»: светлая, тёмная или никакой. */
  pair: 'light' | 'dark' | null;
}

export function followsSystem(selection: ThemeSelection): boolean {
  return selection.theme === 'system';
}

/**
 * Что делает щелчок по теме.
 *
 * Без «Как в Windows» — выбирает тему. С ним щелчок назначает пару своего
 * же оформления: светлая тема заменяет светлую, тёмная — тёмную. Иначе
 * пришлось бы либо запрещать щелчок (и вкладка стала бы витриной), либо
 * молча выключать следование системе — а это настройка, которую человек
 * включил осознанно.
 */
export function choiceFor(theme: ThemeInfo, selection: ThemeSelection): ThemeChoice {
  if (!followsSystem(selection)) {
    return { key: 'theme', value: theme.id };
  }
  return {
    key: theme.appearance === 'light' ? 'light_theme' : 'dark_theme',
    value: theme.id,
  };
}

/** Чем помечена карточка темы. */
export function stateOf(theme: ThemeInfo, selection: ThemeSelection): ThemeState {
  const current = theme.id === selection.currentId;

  if (!followsSystem(selection)) {
    return { current, pair: null };
  }

  // Одна тема может стоять сразу в обеих парах — файл это позволяет. Тогда
  // показываем роль по её собственному оформлению: у светлой темы это светлая
  // пара. Приоритет «всегда светлая» был бы произволом.
  const light = theme.id === selection.lightTheme;
  const dark = theme.id === selection.darkTheme;
  if (light && dark) return { current, pair: theme.appearance === 'light' ? 'light' : 'dark' };
  if (light) return { current, pair: 'light' };
  if (dark) return { current, pair: 'dark' };
  return { current, pair: null };
}

/** Темы, разложенные по оформлению. Порядок внутри — тот, что пришёл из ядра. */
export function grouped(themes: ThemeInfo[]): { light: ThemeInfo[]; dark: ThemeInfo[] } {
  return {
    light: themes.filter((theme) => theme.appearance === 'light'),
    dark: themes.filter((theme) => theme.appearance === 'dark'),
  };
}
