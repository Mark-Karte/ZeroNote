import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Оформление настраивается через токены — или не настраивается вовсе.
 *
 * Это не стилистическое пожелание, а условие работоспособности тем: любой
 * зашитый в компонент цвет или размер молча переживёт смену темы и плотности,
 * и починить это можно будет только вручную обойдя весь интерфейс. Поэтому
 * запрет проверяется тестом, а не договорённостью.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Единственный файл, где литеральные значения разрешены. */
const TOKEN_LAYER = join('src', 'theme', 'tokens.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (full.endsWith('.svelte') || full.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

/** Содержимое блоков <style> компонента либо весь файл, если это .css. */
function styleSource(file: string): string {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.css')) {
    return text;
  }
  const blocks = text.match(/<style[^>]*>([\s\S]*?)<\/style>/g) ?? [];
  return blocks.join('\n');
}

/** Убирает комментарии: пояснения про «#ffffff» не должны валить тест. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface Violation {
  file: string;
  line: number;
  text: string;
  reason: string;
}

const NAMED_COLORS =
  /\b(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|brown|cyan|magenta|teal|navy|olive|maroon|lime|aqua|fuchsia)\b/i;

/** Свойства, значение которых обязано быть токеном, а не голым числом. */
const MUST_BE_TOKEN = [
  'line-height',
  'z-index',
  'font-weight',
  'box-shadow',
  'transition-duration',
  'transition-timing-function',
];

/** Значения, которые не несут оформления и потому разрешены как есть. */
const NEUTRAL_VALUES =
  /^(0|none|auto|inherit|initial|unset|normal|currentcolor|transparent)$/i;

function inspect(file: string): Violation[] {
  const css = stripComments(styleSource(file));
  const violations: Violation[] = [];

  css.split('\n').forEach((rawLine, index) => {
    const line = rawLine.trim();
    const declaration = /^([a-z-]+)\s*:\s*(.+?);?$/i.exec(line);
    if (!declaration) {
      return;
    }

    const property = declaration[1]!.toLowerCase();
    const value = declaration[2]!.trim();

    const add = (reason: string) =>
      violations.push({
        file: relative(root, file).split(sep).join('/'),
        line: index + 1,
        text: line,
        reason,
      });

    if (/#[0-9a-f]{3,8}\b/i.test(value)) {
      add('шестнадцатеричный цвет');
    }
    if (/\b(rgba?|hsla?|hwb|lab|lch|oklch|oklab|color-mix)\s*\(/i.test(value)) {
      add('цветовая функция');
    }
    if (NAMED_COLORS.test(value)) {
      add('цвет по имени');
    }
    // Абсолютные длины и времена. Ноль без единиц разрешён.
    if (/(?<![\w-])\d*\.?\d+(px|pt|pc|in|cm|mm|rem|em|ms|s)(?![\w-])/i.test(value)) {
      add('абсолютная величина');
    }
    if (
      MUST_BE_TOKEN.includes(property) &&
      !value.includes('var(--zn-') &&
      !NEUTRAL_VALUES.test(value)
    ) {
      add(`свойство ${property} должно брать значение из токена`);
    }

    return;
  });

  return violations;
}

describe('слой токенов', () => {
  const files = walk(join(root, 'src')).filter(
    (file) => relative(root, file) !== TOKEN_LAYER,
  );

  it('находит файлы для проверки', () => {
    // Страховка от того, что обход сломается и тест начнёт «проходить» впустую.
    expect(files.length).toBeGreaterThan(0);
  });

  it('в компонентах нет зашитых цветов и размеров', () => {
    const violations = files.flatMap(inspect);

    const report = violations
      .map((v) => `  ${v.file}:${v.line}  ${v.reason}\n    ${v.text}`)
      .join('\n');

    expect(violations, `Найдены зашитые значения оформления:\n${report}`).toEqual([]);
  });
});

describe('набор токенов', () => {
  /**
   * Список токенов задаётся в Rust, а объявляется в CSS. Если они разойдутся,
   * часть интерфейса останется без значений — и заметить это можно будет
   * только глазами, на одной конкретной теме. Поэтому сверяем.
   */
  it('совпадает в tokens.rs и tokens.css', () => {
    const rust = readFileSync(
      join(root, 'src-tauri', 'src', 'theme', 'tokens.rs'),
      'utf8',
    );
    const css = readFileSync(join(root, TOKEN_LAYER), 'utf8');

    const fromRust = new Set(
      [...rust.matchAll(/\(\s*"([a-z0-9-]+)"\s*,\s*"/g)].map((m) => m[1]!),
    );
    const fromCss = new Set(
      [...css.matchAll(/--zn-([a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
    );

    const missingInCss = [...fromRust].filter((n) => !fromCss.has(n)).sort();
    const missingInRust = [...fromCss].filter((n) => !fromRust.has(n)).sort();

    expect(fromRust.size).toBeGreaterThan(0);
    expect(missingInCss, 'объявлены в Rust, но не в tokens.css').toEqual([]);
    expect(missingInRust, 'объявлены в tokens.css, но не в Rust').toEqual([]);
  });
});
