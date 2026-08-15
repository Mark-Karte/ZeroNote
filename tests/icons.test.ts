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

  it('иконки наследуют цвет и переживают смену темы', () => {
    for (const name of names) {
      const markup = icon(name);
      expect(markup, `${name}: цвет должен быть currentColor`).not.toMatch(
        /#[0-9a-f]{3,8}\b/i,
      );
      expect(markup, `${name}: цвет должен быть currentColor`).not.toMatch(
        /\b(rgba?|hsla?)\s*\(/i,
      );
    }
  });

  it('неизвестное имя — громкая ошибка, а не пустота', () => {
    expect(() => icon('нет.такой' as IconName)).toThrow(/не зарегистрирована/);
  });
});
