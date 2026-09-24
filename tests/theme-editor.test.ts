import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { formatColor, parseColor, toHex } from '../src/theme/color';
import {
  cssPropertyOf,
  expandPalette,
  findingText,
  kindOf,
  PALETTE_LABELS,
  SECTIONS,
  splitLength,
  tokenNote,
} from '../src/theme/editor';
import { firstAvailable, pixels, splitFamilies } from '../src/theme/fonts';

/**
 * Редактор тем и шрифты (задача 105): цвет в числа и обратно, вид поля
 * по значению, слова проверки читаемости, разбор списка шрифтов.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const builtinDir = join(root, 'src-tauri', 'src', 'theme', 'builtin');

/** Ключи раздела `[palette]` файла темы, по порядку. */
function paletteKeys(source: string): string[] {
  const keys: string[] = [];
  let inside = false;
  for (const line of source.split('\n')) {
    if (/^\[/.test(line)) inside = line.trim() === '[palette]';
    const key = /^([a-z0-9-]+)\s*=/.exec(line);
    if (inside && key) keys.push(key[1] as string);
  }
  return keys;
}

describe('цвет из файла темы', () => {
  it('разбирает шестнадцатеричный и rgba', () => {
    expect(parseColor('#1b1f27')).toEqual({ r: 27, g: 31, b: 39, a: 1 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgba(96, 148, 255, 0.16)')).toEqual({ r: 96, g: 148, b: 255, a: 0.16 });
    expect(parseColor('rgb(0,0,0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  /** Ссылка на палитру, тень, имя цвета — не то, что понимает выбор цвета. */
  it('не цвет — null', () => {
    expect(parseColor('{palette.bg-0}')).toBeNull();
    expect(parseColor('0 1px 2px rgba(0, 0, 0, 0.2)')).toBeNull();
    expect(parseColor('rebeccapurple')).toBeNull();
    expect(parseColor('rgba(300, 0, 0, 1)')).toBeNull();
  });

  it('пишется так, как пишут темы', () => {
    expect(formatColor({ r: 27, g: 31, b: 39, a: 1 })).toBe('#1b1f27');
    expect(formatColor({ r: 96, g: 148, b: 255, a: 0.16 })).toBe('rgba(96, 148, 255, 0.16)');
    expect(formatColor({ r: 96, g: 148, b: 255, a: 0.123 })).toBe('rgba(96, 148, 255, 0.12)');
    expect(toHex({ r: 96, g: 148, b: 255, a: 0.5 })).toBe('#6094ff');
  });

  it('туда и обратно без потерь', () => {
    for (const value of ['#6094ff', 'rgba(0, 0, 0, 0.58)', 'rgba(10, 12, 18, 0.55)']) {
      const color = parseColor(value);
      expect(color).not.toBeNull();
      expect(formatColor(color!)).toBe(value);
    }
  });
});

describe('палитра в окне', () => {
  /** Новый ключ палитры без подписи остался бы в окне голым именем. */
  it('у каждого ключа встроенных тем есть подпись', () => {
    for (const file of readdirSync(builtinDir).filter((name) => name.endsWith('.toml'))) {
      for (const key of paletteKeys(readFileSync(join(builtinDir, file), 'utf-8'))) {
        expect(PALETTE_LABELS[key], `${file}: ${key}`).toBeTruthy();
      }
    }
  });

  it('разделы — те же девять, что у файла темы', () => {
    const rust = readFileSync(join(root, 'src-tauri', 'src', 'theme', 'mod.rs'), 'utf-8');
    const declared = /pub const SECTIONS: \[&str; 9\] = \[([^\]]+)\]/.exec(rust)?.[1] ?? '';
    const names = [...declared.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(SECTIONS.map((section) => section.id)).toEqual(names);
  });
});

describe('вид поля', () => {
  it('по разделу и умолчанию', () => {
    expect(kindOf('palette', '#000')).toBe('color');
    expect(kindOf('color', '{palette.bg-0}')).toBe('color');
    expect(kindOf('control', '28px')).toBe('length');
    expect(kindOf('font', '1.12em')).toBe('length');
    expect(kindOf('motion', '90ms')).toBe('length');
    expect(kindOf('z', '1000')).toBe('number');
    expect(kindOf('font', '1.5')).toBe('number');
    expect(kindOf('shadow', '0 1px 2px {palette.shadow-weak}')).toBe('text');
    expect(kindOf('motion', 'cubic-bezier(0.2, 0, 0, 1)')).toBe('text');
  });

  it('длина делится на число и единицу', () => {
    expect(splitLength('13px')).toEqual({ amount: 13, unit: 'px' });
    expect(splitLength('-0.02em')).toEqual({ amount: -0.02, unit: 'em' });
    expect(splitLength('82ch')).toEqual({ amount: 82, unit: 'ch' });
    expect(splitLength('auto')).toBeNull();
  });
});

describe('проверка значения до записи', () => {
  /** Судья — `CSS.supports`; здесь проверяется, какому свойству он судит. */
  it('свойство по разделу и ключу', () => {
    expect(cssPropertyOf('palette', 'accent')).toBe('color');
    expect(cssPropertyOf('color', 'bg-canvas')).toBe('color');
    expect(cssPropertyOf('shadow', 'raised')).toBe('box-shadow');
    expect(cssPropertyOf('motion', 'easing')).toBe('transition-timing-function');
    expect(cssPropertyOf('motion', 'duration-fast')).toBe('transition-duration');
    expect(cssPropertyOf('font', 'family-ui')).toBe('font-family');
    expect(cssPropertyOf('font', 'weight-strong')).toBe('font-weight');
    expect(cssPropertyOf('font', 'size-editor')).toBe('font-size');
    expect(cssPropertyOf('z', 'dialog')).toBe('z-index');
  });

  it('ссылки на палитру подставляются перед проверкой', () => {
    const palette = { 'shadow-weak': 'rgba(0, 0, 0, 0.3)', accent: '#6094ff' };
    expect(expandPalette('0 1px 2px {palette.shadow-weak}', palette)).toBe('0 1px 2px rgba(0, 0, 0, 0.3)');
    expect(expandPalette('{palette.accent}', palette)).toBe('#6094ff');
    expect(expandPalette('{palette.missing}', palette)).toBeNull();
  });
});

describe('токены, которые выбирают не здесь', () => {
  /** Без пояснения правка такого токена выглядела бы как «не работает». */
  it('размер кнопок панели и шрифты названы', () => {
    expect(tokenNote('control-toolbar-button-size-large')).toMatch(/Панель инструментов/);
    expect(tokenNote('font-size-editor')).toMatch(/Шрифтах/);
    expect(tokenNote('control-tab-height')).toBeNull();
  });
});

describe('слова проверки читаемости', () => {
  it('контраст называет роль, фон и числа', () => {
    expect(
      findingText({
        kind: 'contrast',
        token: 'color-syntax-comment',
        against: 'color-bg-canvas',
        value: 3.14,
        need: 4.5,
      }),
    ).toBe('Комментарии на подложке: 3,1 : 1, нужно 4,5');
  });

  it('текст на акценте не повторяет «на акценте» дважды', () => {
    expect(
      findingText({
        kind: 'contrast',
        token: 'color-fg-on-accent',
        against: 'color-accent',
        value: 3,
        need: 4.5,
      }),
    ).toBe('Текст на акценте: 3,0 : 1, нужно 4,5');
  });

  it('неразличимые цвета называются парой', () => {
    expect(
      findingText({
        kind: 'distance',
        token: 'color-syntax-type',
        against: 'color-syntax-number',
        value: 16.4,
        need: 20,
      }),
    ).toBe('Типы и числа почти одного цвета: различие 16, нужно 20');
  });
});

describe('шрифты', () => {
  it('список CSS разбирается в имена', () => {
    expect(
      splitFamilies("'IBM Plex Sans', 'Segoe UI Variable Text', \"Segoe UI\", system-ui, sans-serif"),
    ).toEqual(['IBM Plex Sans', 'Segoe UI Variable Text', 'Segoe UI', 'system-ui', 'sans-serif']);
  });

  /** Выбранного нет — на экране следующий, и подпись обязана это сказать. */
  it('на экране — первый доступный', () => {
    const none = (): boolean => false;
    const only = (name: string) => (candidate: string) => candidate === name;

    expect(firstAvailable(['Fira Code', 'JetBrains Mono', 'monospace'], none)).toEqual({
      name: 'JetBrains Mono',
      source: 'bundled',
    });
    expect(firstAvailable(['Fira Code', 'Consolas', 'monospace'], only('Consolas'))).toEqual({
      name: 'Consolas',
      source: 'system',
    });
    expect(firstAvailable(['Нет-такого', 'monospace'], none)).toEqual({
      name: 'monospace',
      source: 'generic',
    });
    expect(firstAvailable(['Нет-такого'], none)).toBeNull();
  });

  it('размер из токена', () => {
    expect(pixels('14px')).toBe(14);
    expect(pixels('1.5em')).toBeNull();
    expect(pixels(undefined)).toBeNull();
  });
});
