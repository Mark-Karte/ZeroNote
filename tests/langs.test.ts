import { describe, expect, it } from 'vitest';

import { LANGUAGES, languageById, languageForFile } from '../src/editor/langs';

/**
 * Реестр языков подсветки.
 *
 * Загрузчики здесь не вызываются: они тянут парсеры по требованию, и проверять
 * надо не их, а сам реестр — по нему определяется язык файла, и ошибка в нём
 * означает либо подсветку не тем языком, либо её отсутствие.
 */

describe('реестр языков', () => {
  it('не содержит повторяющихся имён', () => {
    const ids = LANGUAGES.map((lang) => lang.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Два языка на одно расширение означали бы, что выбор зависит от порядка
   * в массиве, — то есть меняется при любой перестановке строк.
   */
  it('не назначает одно расширение двум языкам', () => {
    const seen = new Map<string, string>();

    for (const lang of LANGUAGES) {
      for (const ext of lang.extensions) {
        const other = seen.get(ext);
        expect(other, `расширение .${ext} занято дважды: ${other} и ${lang.id}`).toBe(
          undefined,
        );
        seen.set(ext, lang.id);
      }
    }
  });

  it('расширения записаны без точки и в нижнем регистре', () => {
    for (const lang of LANGUAGES) {
      for (const ext of lang.extensions) {
        expect(ext, `${lang.id}: ${ext}`).toBe(ext.toLowerCase());
        expect(ext.startsWith('.'), `${lang.id}: ${ext}`).toBe(false);
      }
    }
  });

  /** Языки владельца проекта. Их отсутствие — не мелочь, а потеря основного. */
  it('покрывает C, C++, Rust и markdown', () => {
    expect(languageForFile('main.c')?.id).toBe('cpp');
    expect(languageForFile('widget.cpp')?.id).toBe('cpp');
    expect(languageForFile('widget.hpp')?.id).toBe('cpp');
    expect(languageForFile('lib.rs')?.id).toBe('rust');
    expect(languageForFile('заметка.md')?.id).toBe('markdown');
  });

  it('не зависит от регистра расширения', () => {
    expect(languageForFile('README.MD')?.id).toBe('markdown');
    expect(languageForFile('Main.C')?.id).toBe('cpp');
  });

  /**
   * Незнакомое расширение — обычный текст, а не догадка: неверная подсветка
   * хуже отсутствующей, потому что врёт про структуру (Р-066).
   */
  it('на незнакомое расширение отвечает пустотой', () => {
    expect(languageForFile('архив.zip')).toBeNull();
    expect(languageForFile('данные.неизвестно')).toBeNull();
    expect(languageForFile(null)).toBeNull();
  });

  /** Файл без расширения — тоже обычный текст, а не «попробуем markdown». */
  it('файл без расширения оставляет без подсветки', () => {
    expect(languageForFile('LICENSE')).toBeNull();
    expect(languageForFile('Makefile')).toBeNull();
  });

  /**
   * Имя, начинающееся с точки, — это имя, а не расширение: `.gitignore`
   * не должен считаться файлом с расширением `gitignore`.
   */
  it('точку в начале имени за расширение не принимает', () => {
    expect(languageForFile('.gitignore')).toBeNull();
    // А то, что перечислено по имени целиком, — узнаёт.
    expect(languageForFile('.editorconfig')?.id).toBe('ini');
  });

  it('находит язык по имени и не выдумывает несуществующие', () => {
    expect(languageById('rust')?.label).toBe('Rust');
    expect(languageById('такого-нет')).toBeNull();
    expect(languageById(null)).toBeNull();
    // «Без подсветки» из строки состояния — не язык, и языком стать не должно.
    expect(languageById('none')).toBeNull();
  });

  it('у каждого языка есть подпись для строки состояния', () => {
    for (const lang of LANGUAGES) {
      expect(lang.label.trim(), lang.id).not.toBe('');
    }
  });
});
