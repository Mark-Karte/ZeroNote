import { describe, expect, it } from 'vitest';
import { icon, iconNames, type IconName } from '../src/icons/registry';

/**
 * Реестр иконок — заменяемый слой. Чтобы замена набора действительно сводилась
 * к правке одного файла, каждая иконка обязана подчиняться двум правилам:
 * размер задаётся снаружи, цвет наследуется. Иначе новый набор придётся
 * подгонять по всему интерфейсу.
 */
describe('реестр иконок', () => {
  const names = iconNames();

  it('не пуст', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it('иконки не задают собственный размер', () => {
    for (const name of names) {
      const markup = icon(name);
      expect(markup, name).toContain('viewBox=');
      expect(markup, `${name}: размер задаёт токен, а не сама иконка`).not.toMatch(
        /<svg[^>]*\s(width|height)=/,
      );
    }
  });

  /**
   * Знак приложения — единственная двухцветная иконка (Р-099). Ему разрешён
   * акцент, потому что штрих в знаке акцентный по рисунку, а не по прихоти
   * места, где знак выводится. Всем остальным цвет задаёт контекст: иконка,
   * назначившая себе роль, перестаёт быть заменяемой.
   */
  const withAccent = new Set<IconName>(['app.mark']);

  it('иконки берут цвет из контекста и переживают смену темы', () => {
    for (const name of names) {
      const allowed = withAccent.has(name)
        ? /^(none|currentColor|var\(--zn-color-accent\))$/
        : /^(none|currentColor)$/;

      const markup = icon(name);
      const colours = [...markup.matchAll(/\b(?:fill|stroke|stop-color)="([^"]*)"/g)];
      let seen = 0;

      for (const match of colours) {
        const colour = match[1] ?? '';
        seen += 1;
        expect(allowed.test(colour), `${name}: цвет «${colour}» не от темы`).toBe(true);
      }

      expect(seen, `${name}: цвет не задан вовсе — иконка будет чёрной`).toBeGreaterThan(0);
    }
  });

  it('неизвестное имя — громкая ошибка, а не пустота', () => {
    expect(() => icon('нет.такой' as IconName)).toThrow(/не зарегистрирована/);
  });
});
