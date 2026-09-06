import { describe, expect, it } from 'vitest';
import { CALLOUT_ICON, parseCallout } from '../src/editor/callouts';
import { iconNames } from '../src/icons/registry';

/**
 * Разбор знака callout-а.
 *
 * Здесь проверяется то, что решает, будет карточка или нет: как выглядит знак
 * и где он кончается. Вид карточки — на живом окне, тестом его не поймать.
 */

describe('знак callout-а', () => {
  it('находится в первой строке цитаты', () => {
    const marker = parseCallout('> [!tip] Совет');

    expect(marker).not.toBeNull();
    expect(marker?.type).toBe('tip');
    expect(marker?.kind).toBe('tip');
    // Знак кончается вместе с пробелом за ним: заголовок начинается с буквы.
    expect('> [!tip] Совет'.slice(marker!.from, marker!.to)).toBe('[!tip] ');
  });

  it('обычная цитата знака не имеет', () => {
    expect(parseCallout('> просто цитата')).toBeNull();
    expect(parseCallout('обычная строка')).toBeNull();
    expect(parseCallout('> [не callout] текст')).toBeNull();
  });

  it('тип читается без учёта регистра, синонимы сводятся к роли', () => {
    expect(parseCallout('> [!TIP]')?.type).toBe('tip');
    expect(parseCallout('> [!Warning] Осторожно')?.kind).toBe('warning');
    expect(parseCallout('> [!bug] Дефект')?.kind).toBe('danger');
    expect(parseCallout('> [!summary]')?.kind).toBe('note');
    expect(parseCallout('> [!cite] Источник')?.kind).toBe('quote');
  });

  it('незнакомый тип становится заметкой, а не остаётся текстом', () => {
    const marker = parseCallout('> [!придумал] Своё');

    expect(marker?.type).toBe('придумал');
    expect(marker?.kind).toBe('note');
  });

  it('знак свёртки разбирается и уходит со знаком', () => {
    const line = '> [!tip]- Свёрнутый';
    const marker = parseCallout(line);

    expect(marker?.kind).toBe('tip');
    expect(line.slice(marker!.from, marker!.to)).toBe('[!tip]- ');
  });

  it('вложенный callout тоже находится', () => {
    const line = '>> [!danger] Внутри';
    const marker = parseCallout(line);

    expect(marker?.kind).toBe('danger');
    expect(line.slice(marker!.from, marker!.to)).toBe('[!danger] ');
  });

  it('заголовка может не быть вовсе', () => {
    const line = '> [!note]';
    const marker = parseCallout(line);

    expect(marker?.kind).toBe('note');
    // Конец знака упирается в конец строки: показывать будет нечего,
    // кроме значка, и это правильный ответ — своих слов мы не придумываем.
    expect(marker?.to).toBe(line.length);
  });

  it('у каждой роли есть настоящий значок', () => {
    const known = new Set(iconNames());

    for (const [kind, name] of Object.entries(CALLOUT_ICON)) {
      expect(known.has(name), `${kind}: значка ${name} нет в реестре`).toBe(true);
    }
  });
});
