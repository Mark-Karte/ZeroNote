import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Уведомления о сторонних компонентах (приёмка этапа 17): файл
 * THIRD-PARTY-NOTICES.md собирает `npm run licenses`, и он лежит в git.
 * Собирается он не при каждой сборке — нужен полный vite и cargo, — поэтому
 * здесь ловится, что файл устарел: версия программы, версии пакетов,
 * крупные библиотеки на месте, у каждой записи есть текст лицензии.
 */

const notices = readFileSync('THIRD-PARTY-NOTICES.md', 'utf8');
const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

/** Записи раздела: `### имя версия` между заголовками `## Раздел`. */
function section(title: string): Array<{ name: string; version: string; body: string }> {
  const start = notices.indexOf(`## ${title}`);
  expect(start, `раздел «${title}»`).toBeGreaterThanOrEqual(0);
  const end = notices.indexOf('\n## ', start + 1);
  const text = notices.slice(start, end < 0 ? undefined : end);
  return text
    .split('\n### ')
    .slice(1)
    .map((part) => {
      const [head = '', ...rest] = part.split('\n');
      const at = head.lastIndexOf(' ');
      return { name: head.slice(0, at), version: head.slice(at + 1), body: rest.join('\n') };
    });
}

describe('уведомления о сторонних компонентах', () => {
  /** Выпуск без перегенерации файла падает здесь. */
  it('собраны для этой версии программы', () => {
    expect(notices).toContain(`Версия ZeroNote: ${version}.`);
  });

  it('библиотеки окна — тех версий, что стоят', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    const installed = new Set(
      Object.entries(lock.packages).map(([key, value]) => `${key.replace(/^.*node_modules\//, '')}@${value.version}`),
    );
    const listed = section('Библиотеки окна (JavaScript)');
    expect(listed.length).toBeGreaterThan(50);
    const stale = listed.filter((item) => !installed.has(`${item.name}@${item.version}`));
    expect(stale.map((item) => `${item.name}@${item.version}`)).toEqual([]);
    const names = listed.map((item) => item.name);
    for (const name of ['mermaid', 'temml', 'pdfjs-dist', 'svelte', '@codemirror/view', 'dompurify', 'elkjs']) {
      expect(names).toContain(name);
    }
  });

  it('крейты ядра — тех версий, что в Cargo.lock', () => {
    const lock = readFileSync('src-tauri/Cargo.lock', 'utf8');
    const locked = new Set(
      [...lock.matchAll(/\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g)].map((m) => `${m[1]}@${m[2]}`),
    );
    const listed = section('Библиотеки ядра (Rust)');
    expect(listed.length).toBeGreaterThan(100);
    const stale = listed.filter((item) => !locked.has(`${item.name}@${item.version}`));
    expect(stale.map((item) => `${item.name}@${item.version}`)).toEqual([]);
    const names = listed.map((item) => item.name);
    for (const name of ['tauri', 'rusqlite', 'notify', 'ignore', 'toml_edit', 'encoding_rs']) {
      expect(names).toContain(name);
    }
  });

  /** Запись без текста лицензии — то, ради чего файл и заведён. */
  it('у каждой записи есть текст лицензии', () => {
    for (const title of ['Шрифты', 'Палитры встроенных тем', 'Библиотеки окна (JavaScript)', 'Библиотеки ядра (Rust)']) {
      const missing = section(title).filter((item) => !/Текст — № \d+/.test(item.body));
      expect(missing.map((item) => item.name), title).toEqual([]);
    }
  });
});
