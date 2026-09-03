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

/** Слой токенов: единственное место, где литеральные цвета и размеры уместны. */
const TOKEN_LAYER = join('src', 'theme', 'tokens.css');

/**
 * Объявление вшитых шрифтов. Тоже с литералами, но другого рода: вес и
 * диапазон символов там — свойства файла шрифта, а не выбор оформления.
 * Чтобы послабление не превратилось в лазейку, ниже отдельно проверяется,
 * что в файле нет ничего, кроме @font-face.
 */
const FONT_LAYER = join('src', 'theme', 'fonts.css');

const EXEMPT = [TOKEN_LAYER, FONT_LAYER];

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
    (file) => !EXEMPT.includes(relative(root, file)),
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

describe('объявление шрифтов', () => {
  /**
   * fonts.css выведен из-под проверки на литералы. Значит, в нём можно было бы
   * незаметно спрятать оформление — например, задать цвет фона. Поэтому
   * проверяем состав: кроме блоков @font-face в файле не должно быть ничего.
   */
  it('в fonts.css нет ничего, кроме @font-face', () => {
    const css = stripComments(readFileSync(join(root, FONT_LAYER), 'utf8'));
    const rest = css.replace(/@font-face\s*\{[^}]*\}/g, '').trim();

    expect(rest, `за пределами @font-face осталось: ${rest}`).toBe('');
  });

  /** Пустой файл прошёл бы проверку выше, ничего не проверив. */
  it('объявлены оба семейства в обоих начертаниях', () => {
    const css = readFileSync(join(root, FONT_LAYER), 'utf8');
    const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];

    expect(blocks.length).toBe(4);
    for (const family of ['IBM Plex Sans', 'JetBrains Mono']) {
      const own = blocks.filter((b) => b.includes(family));
      expect(own.length, `${family}: ожидались латиница и кириллица`).toBe(2);
    }
  });

  /** Файл шрифта, потерянный при правке, — это молча уехавшая метрика. */
  it('каждый объявленный файл существует', () => {
    const css = readFileSync(join(root, FONT_LAYER), 'utf8');
    const urls = [...css.matchAll(/url\('\.\/([^']+)'\)/g)].map((m) => m[1]!);

    expect(urls.length).toBe(4);
    for (const url of urls) {
      const file = join(root, 'src', 'theme', url);
      expect(statSync(file).size, `${url} пуст`).toBeGreaterThan(0);
    }
  });
});

describe('ссылки на токены', () => {
  /**
   * Опечатка в имени токена не ломает ничего заметного: `var(--zn-опечатка)`
   * молча даёт пустое значение, свойство отбрасывается, и элемент едет
   * на умолчании браузера. Проверка на литералы этого не ловит — там всё
   * честно взято из переменной, просто из несуществующей.
   *
   * Заодно проверяются и объявления: компонент вправе переопределить токен
   * у себя (так значок берёт размер из контекста, Р-100), но не вправе
   * завести под видом токена собственную переменную.
   */
  const declared = new Set(
    [...readFileSync(join(root, TOKEN_LAYER), 'utf8').matchAll(/--zn-([a-z0-9-]+)\s*:/g)].map(
      (m) => m[1]!,
    ),
  );

  const files = walk(join(root, 'src')).filter(
    (file) => relative(root, file) !== TOKEN_LAYER,
  );

  it('каждая переменная --zn- объявлена в слое токенов', () => {
    const unknown: string[] = [];
    let seen = 0;

    for (const file of files) {
      const css = stripComments(styleSource(file));
      const used = [
        ...[...css.matchAll(/var\(\s*--zn-([a-z0-9-]+)/g)].map((m) => m[1]!),
        ...[...css.matchAll(/(?:^|[;{\s])--zn-([a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
      ];

      seen += used.length;
      for (const name of used) {
        if (!declared.has(name)) {
          unknown.push(`${relative(root, file).split(sep).join('/')}: --zn-${name}`);
        }
      }
    }

    expect(declared.size).toBeGreaterThan(0);
    // Страховка от того, что обход или выражение сломаются и тест начнёт
    // «проходить», не просмотрев ни строчки.
    expect(seen, 'ссылок на токены не найдено вовсе').toBeGreaterThan(200);
    expect([...new Set(unknown)].sort(), 'таких токенов нет').toEqual([]);
  });

  /** Проверка, которая ничего не проверяет, выглядит так же, как прошедшая. */
  it('ловит несуществующий токен', () => {
    expect(declared.has('control-icon-size')).toBe(true);
    expect(declared.has('control-icon-size-которого-нет')).toBe(false);
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
