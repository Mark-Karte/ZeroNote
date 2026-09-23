import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  COLOR_TOKENS,
  cssColorOf,
  iconOf,
  lookupFor,
  parseCallout,
  type CalloutDef,
} from '../src/editor/callouts';
import { iconNames } from '../src/icons/registry';

/**
 * Коллауты: разбор знака и список человека (задача 103).
 *
 * Здесь проверяется то, что решает, будет карточка или нет, и то, что
 * связывает список из файла с приложением: значки из образца есть
 * в реестре, роли цвета — те же, что в ядре, и каждая ведёт к объявленному
 * токену. Вид карточки — на живом окне, тестом его не поймать.
 */

const root = join(__dirname, '..');
const RUST = readFileSync(join(root, 'src-tauri', 'src', 'callouts', 'mod.rs'), 'utf8');
const TOKENS = readFileSync(join(root, 'src', 'theme', 'tokens.css'), 'utf8');

describe('знак коллаута', () => {
  it('находится в первой строке цитаты', () => {
    const marker = parseCallout('> [!tip] Совет');

    expect(marker?.type).toBe('tip');
    // Знак кончается вместе с пробелом за ним: заголовок начинается с буквы.
    expect('> [!tip] Совет'.slice(marker!.from, marker!.to)).toBe('[!tip] ');
  });

  it('обычная цитата знака не имеет', () => {
    expect(parseCallout('> просто цитата')).toBeNull();
    expect(parseCallout('обычная строка')).toBeNull();
    expect(parseCallout('> [не коллаут] текст')).toBeNull();
  });

  it('тип читается без учёта регистра', () => {
    expect(parseCallout('> [!TIP]')?.type).toBe('tip');
    expect(parseCallout('> [!Warning] Осторожно')?.type).toBe('warning');
  });

  it('знак свёртки разбирается и уходит со знаком', () => {
    const line = '> [!tip]- Свёрнутый';
    const marker = parseCallout(line);
    expect(line.slice(marker!.from, marker!.to)).toBe('[!tip]- ');
  });

  it('вложенный коллаут тоже находится', () => {
    const line = '>> [!danger] Внутри';
    const marker = parseCallout(line);
    expect(line.slice(marker!.from, marker!.to)).toBe('[!danger] ');
  });

  it('заголовка может не быть вовсе', () => {
    const line = '> [!note]';
    // Конец знака упирается в конец строки: показывать будет нечего,
    // кроме значка, и это правильный ответ — своих слов мы не придумываем.
    expect(parseCallout(line)?.to).toBe(line.length);
  });
});

describe('список коллаутов', () => {
  const LIST: CalloutDef[] = [
    { id: 'note', title: 'Заметка', icon: 'md.callout-pencil', color: 'accent' },
    { id: 'bug', title: 'Баг', icon: 'md.callout-bug', color: 'danger' },
    { id: 'моё', title: 'Моё', icon: 'нет-такого', color: '#ff8800' },
  ];

  it('даёт значок и цвет по типу', () => {
    const style = lookupFor(LIST)('bug');
    expect(style.icon).toBe('md.callout-bug');
    expect(style.color).toBe('var(--zn-color-danger)');
  });

  it('незнакомый тип рисуется как note, а не остаётся текстом', () => {
    expect(lookupFor(LIST)('придумал').icon).toBe('md.callout-pencil');
  });

  it('без note в списке — значком заметки и акцентом', () => {
    const style = lookupFor([])('что угодно');
    expect(style.icon).toBe('md.callout-note');
    expect(style.color).toBe('var(--zn-color-accent)');
  });

  it('свой цвет идёт как есть, незнакомый значок становится значком заметки', () => {
    const style = lookupFor(LIST)('моё');
    expect(style.color).toBe('#ff8800');
    expect(style.icon).toBe('md.callout-note');
    expect(iconOf('md.callout-bug')).toBe('md.callout-bug');
  });

  it('роли цвета — те же, что в ядре', () => {
    const rust = /COLOR_ROLES: &\[&str\] = &\[([^\]]+)\]/.exec(RUST)?.[1] ?? '';
    const roles = [...rust.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!);

    expect(roles.length).toBeGreaterThan(5);
    expect(Object.keys(COLOR_TOKENS).sort()).toEqual([...roles].sort());
  });

  /**
   * Токен роли обязан быть объявлен: `var(--zn-опечатка)` молча пуст,
   * и карточка вышла бы без цвета. Тест токенов этого не видит — цвет
   * ставится свойством строки из кода, а не из файла стилей.
   */
  it('каждая роль ведёт к объявленному токену', () => {
    for (const [role, token] of Object.entries(COLOR_TOKENS)) {
      expect(TOKENS.includes(`${token}:`), `${role}: ${token} не объявлен`).toBe(true);
      expect(cssColorOf(role)).toBe(`var(${token})`);
    }
  });

  /** Образец ядра ссылается только на значки, которые есть в реестре. */
  it('значки образца есть в реестре', () => {
    const known = new Set<string>(iconNames());
    const used = [...RUST.matchAll(/^icon = "([^"]+)"$/gm)].map((m) => m[1]!);

    expect(used.length).toBe(27);
    for (const name of used) {
      expect(known.has(name), `значка ${name} нет в реестре`).toBe(true);
    }
  });
});
