import { describe, expect, it } from 'vitest';
import { lineNumbersOn, lineNumbersSettingOf } from '../src/editor/line-numbers';

/**
 * Номера строк (задача 80, Р-213). Правило короткое, но в нём два решения,
 * которые иначе пришлось бы вспоминать: прозой считается только markdown,
 * а «никогда» относится к числу, а не к полю — последнее проверяется
 * не здесь, а тем, что `lineNumbers()` из набора расширений не исчезает.
 */

describe('где показывать номера строк', () => {
  it('«всегда» не смотрит на язык', () => {
    expect(lineNumbersOn({ setting: 'always', markdown: true })).toBe(true);
    expect(lineNumbersOn({ setting: 'always', markdown: false })).toBe(true);
  });

  it('«никогда» тоже не смотрит на язык', () => {
    expect(lineNumbersOn({ setting: 'never', markdown: true })).toBe(false);
    expect(lineNumbersOn({ setting: 'never', markdown: false })).toBe(false);
  });

  it('«только в коде» прячет номера у markdown', () => {
    expect(lineNumbersOn({ setting: 'code', markdown: true })).toBe(false);
  });

  /**
   * Главное решение правила (Р-214). Файл без языка — `.txt`, безымянный
   * буфер, незнакомое расширение — номера сохраняет: чаще всего это лог
   * или вставленный кусок кода. Прозой мы узнаём ровно одну вещь — заметку.
   */
  it('«только в коде» оставляет номера везде, кроме markdown', () => {
    expect(lineNumbersOn({ setting: 'code', markdown: false })).toBe(true);
  });
});

describe('значение настройки из файла', () => {
  it('читается как есть', () => {
    expect(lineNumbersSettingOf('always')).toBe('always');
    expect(lineNumbersSettingOf('never')).toBe('never');
    expect(lineNumbersSettingOf('code')).toBe('code');
  });

  /** Ключа нет — умолчание ядра, а не «никогда». */
  it('без значения даёт «только в коде»', () => {
    expect(lineNumbersSettingOf(undefined)).toBe('code');
  });

  /** Про незнакомое уже сказало ядро при разборе `settings.toml`. */
  it('незнакомое значение падает на умолчание', () => {
    expect(lineNumbersSettingOf('иногда')).toBe('code');
  });
});
