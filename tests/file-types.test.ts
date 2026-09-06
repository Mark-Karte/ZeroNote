import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEXT_EXTENSIONS, FILE_FILTERS } from '../src/actions/file-types';

/**
 * Один список типов файлов на два места.
 *
 * Окно выбора файла живёт во фронтенде, «Открыть с помощью» — в установщике,
 * и оба говорят об одном и том же: что ZeroNote берётся открывать. Разойтись
 * они могут молча, и увидеть это можно будет только в проводнике на чужой
 * машине после выпуска.
 *
 * Тот же приём, что у токенов оформления и у реестра команд: канонический
 * список в одном месте, потребитель в другом, тест сверяет.
 */
const NSH = readFileSync('src-tauri/installer/associations.nsh', 'utf8');

function extensionsInInstaller(): string[] {
  return [...NSH.matchAll(/!insertmacro \$\{ACTION\} "([^"]+)"/g)].map((m) => m[1]!);
}

describe('типы файлов', () => {
  it('в установщике те же, что в окне выбора файла', () => {
    const installer = extensionsInInstaller();

    expect(installer.length).toBeGreaterThan(0);
    // Порядок не сверяем: для реестра он ничего не значит, и требовать его
    // было бы правилом без причины.
    expect([...installer].sort()).toEqual([...TEXT_EXTENSIONS].sort());
  });

  /** Точка — часть шаблона диалога, а не расширения. Перепутать легко. */
  it('записаны без точки и в нижнем регистре', () => {
    for (const ext of TEXT_EXTENSIONS) {
      expect(ext).toBe(ext.toLowerCase());
      expect(ext.startsWith('.')).toBe(false);
    }
  });

  /** «Все файлы» обязаны остаться: открывать мы умеем любой текст. */
  it('диалог не ограничивается известными типами', () => {
    expect(FILE_FILTERS.at(-1)?.extensions).toEqual(['*']);
  });
});
