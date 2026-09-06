import { describe, expect, it } from 'vitest';
import type { ThemeInfo } from '../src/ipc/appearance';
import { choiceFor, followsSystem, grouped, stateOf } from '../src/ui/settings/themes';

/**
 * Правила вкладки «Темы».
 *
 * Проверяется то, что нельзя увидеть на снимке: щелчок по карточке значит
 * разное при «Как в Windows» и без него, а пометок на карточке бывает две.
 */

const theme = (id: string, appearance: 'light' | 'dark'): ThemeInfo => ({
  id,
  name: id,
  appearance,
  builtin: true,
});

const DARK = theme('dark', 'dark');
const LIGHT = theme('light', 'light');

describe('вкладка «Темы»', () => {
  it('без следования системе щелчок выбирает тему', () => {
    const selection = {
      theme: 'dark',
      lightTheme: 'light',
      darkTheme: 'dark',
      currentId: 'dark',
    };

    expect(followsSystem(selection)).toBe(false);
    expect(choiceFor(LIGHT, selection)).toEqual({ key: 'theme', value: 'light' });
  });

  it('при «Как в Windows» щелчок назначает пару своего же оформления', () => {
    const selection = {
      theme: 'system',
      lightTheme: 'light',
      darkTheme: 'dark',
      currentId: 'dark',
    };

    expect(choiceFor(theme('solarized-light', 'light'), selection)).toEqual({
      key: 'light_theme',
      value: 'solarized-light',
    });
    expect(choiceFor(theme('dracula', 'dark'), selection)).toEqual({
      key: 'dark_theme',
      value: 'dracula',
    });
  });

  it('щелчок при «Как в Windows» не выключает следование системе', () => {
    const selection = {
      theme: 'system',
      lightTheme: 'light',
      darkTheme: 'dark',
      currentId: 'dark',
    };

    // Ключ `theme` остаётся нетронутым — иначе настройка, включённая осознанно,
    // пропадала бы от щелчка по карточке.
    expect(choiceFor(LIGHT, selection).key).not.toBe('theme');
  });

  it('пометка «применена сейчас» стоит ровно на одной теме', () => {
    const selection = {
      theme: 'system',
      lightTheme: 'light',
      darkTheme: 'dark',
      currentId: 'dark',
    };

    expect(stateOf(DARK, selection)).toEqual({ current: true, pair: 'dark' });
    expect(stateOf(LIGHT, selection)).toEqual({ current: false, pair: 'light' });
  });

  it('без следования системе пометок пары нет вовсе', () => {
    const selection = {
      theme: 'light',
      lightTheme: 'light',
      darkTheme: 'dark',
      currentId: 'light',
    };

    expect(stateOf(LIGHT, selection)).toEqual({ current: true, pair: null });
    expect(stateOf(DARK, selection)).toEqual({ current: false, pair: null });
  });

  it('тема, стоящая в обеих парах, помечена по своему оформлению', () => {
    const selection = {
      theme: 'system',
      lightTheme: 'contrast',
      darkTheme: 'contrast',
      currentId: 'contrast',
    };

    expect(stateOf(theme('contrast', 'dark'), selection).pair).toBe('dark');
  });

  it('темы раскладываются по оформлению, порядок ядра сохраняется', () => {
    const list = [LIGHT, DARK, theme('dracula', 'dark')];

    expect(grouped(list).light.map((t) => t.id)).toEqual(['light']);
    expect(grouped(list).dark.map((t) => t.id)).toEqual(['dark', 'dracula']);
  });
});
