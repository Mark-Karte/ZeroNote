import { describe, expect, it } from 'vitest';

import { aboutLines, aboutText, nameAndVersion } from '../src/about';
import { version } from '../src/version';

/**
 * Сведения о программе. Их называют в переписке, отвечая на вопрос
 * «какая у вас версия», и врать в них нельзя ни одной строкой.
 */

describe('сведения о программе', () => {
  it('называют версию из единственного её места', () => {
    expect(nameAndVersion()).toBe(`ZeroNote ${version}`);
    expect(aboutText('152.0.3610.86')).toContain(version);
  });

  it('умещаются в две строки', () => {
    expect(aboutLines('152.0.3610.86')).toEqual([
      `ZeroNote ${version}`,
      'WebView2 152.0.3610.86',
    ]);
  });

  /**
   * Неизвестное называется неизвестным. Строка `WebView2 null` в отчёте
   * об ошибке выглядит дефектом приложения — и уводит разбор не туда.
   */
  it('не подставляют пустоту вместо неизвестной версии оболочки', () => {
    const text = aboutText(null);
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
    expect(text).toContain('неизвестна');
  });
});
