import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { version } from '../src/version';

/**
 * Номер версии продублирован в четырёх местах: этого требуют package.json,
 * Cargo.toml и tauri.conf.json, каждый со своим форматом. Расхождение проявилось
 * бы только на собранном установщике, поэтому сверяем тестом.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(relative: string): string {
  return readFileSync(join(root, relative), 'utf8');
}

function extract(source: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(source);
  if (!match?.[1]) {
    throw new Error(`не удалось найти версию в ${label}`);
  }
  return match[1];
}

describe('версия проекта', () => {
  it('одинакова во всех файлах', () => {
    const fromPackage = extract(
      read('package.json'),
      /"version"\s*:\s*"([^"]+)"/,
      'package.json',
    );
    const fromTauriConf = extract(
      read('src-tauri/tauri.conf.json'),
      /"version"\s*:\s*"([^"]+)"/,
      'tauri.conf.json',
    );
    // В Cargo.toml есть и version зависимостей, поэтому якоримся на секцию
    // [package]: берём первое вхождение version в начале строки.
    const fromCargo = extract(
      read('src-tauri/Cargo.toml'),
      /^version\s*=\s*"([^"]+)"/m,
      'Cargo.toml',
    );

    expect(fromPackage).toBe(version);
    expect(fromTauriConf).toBe(version);
    expect(fromCargo).toBe(version);
  });
});
