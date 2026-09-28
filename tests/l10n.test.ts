import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';

import en from '../l10n/en.json';
import ru from '../l10n/ru.json';
import { formatNumber, language, t, tn, useLanguage, type Message } from '../src/l10n';

/**
 * Перевод интерфейса (задача 152, Р-314): таблицы, ключи и сторож.
 *
 * Таблица — плоский JSON на язык в `l10n/`. Компилятор ключей не видит,
 * поэтому его работу делают тесты: у языков одни и те же ключи
 * и подстановки, каждый ключ, который зовёт код, есть в таблице, и в коде
 * нет русских строк мимо таблиц — кроме файлов, ещё ждущих перевода.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NBSP = String.fromCharCode(0xa0);

afterEach(() => useLanguage('ru', ru));

describe('t и tn', () => {
  it('русский: подстановки, формы числа, разряды', () => {
    expect(language()).toBe('ru');
    expect(t('status.position', { line: 3, column: 14 })).toBe('стр 3, кол 14');
    expect(tn('status.words', 1)).toBe('1 слово');
    expect(tn('status.words', 22)).toBe('22 слова');
    expect(tn('status.words', 11)).toBe('11 слов');
    expect(tn('status.words', 12345)).toBe(`12${NBSP}345 слов`);
    expect(formatNumber(1.4, { minimumFractionDigits: 1 })).toBe('1,4');
  });

  it('английский — та же функция с другой таблицей', () => {
    useLanguage('en', en);
    expect(t('status.position', { line: 3, column: 14 })).toBe('Ln 3, Col 14');
    expect(tn('status.words', 1)).toBe('1 word');
    expect(tn('status.words', 0)).toBe('0 words');
    expect(tn('status.words.selected', 1234, { selected: 12 })).toBe('12 of 1,234 words');
    expect(formatNumber(1.4, { minimumFractionDigits: 1 })).toBe('1.4');
  });

  it('ключа нет — виден сам ключ; незнакомая подстановка остаётся текстом', () => {
    expect(t('нет.такого')).toBe('нет.такого');
    expect(tn('нет.такого', 2)).toBe('нет.такого');
    useLanguage('en', { k: 'Use {{date}} and {name}' });
    expect(t('k', { name: 'X' })).toBe('Use {{date}} and X');
  });
});

// ---------------------------------------------------------------------------
// Таблицы

type RawTable = Record<string, Message>;

function readTables(): Record<string, RawTable> {
  const dir = join(root, 'l10n');
  const tables: Record<string, RawTable> = {};
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
    tables[name.slice(0, -'.json'.length)] = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  }
  return tables;
}

const FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

function placeholders(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  const names = new Set<string>();
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) names.add(match[1]!);
  }
  return [...names].sort();
}

/** Какие формы числа язык требует у целых — по `Intl`, а не по памяти. */
function requiredForms(code: string): string[] {
  const rules = new Intl.PluralRules(code);
  const forms = new Set<string>();
  for (let n = 0; n < 1000; n += 1) forms.add(rules.select(n));
  return [...forms].sort();
}

describe('таблицы строк', () => {
  const tables = readTables();

  it('есть русская и английская; импорт теста — те же файлы', () => {
    expect(Object.keys(tables).sort()).toEqual(['en', 'ru']);
    expect(tables.ru).toEqual(ru);
    expect(tables.en).toEqual(en);
  });

  it('у всех языков одни и те же ключи, тот же вид и те же подстановки', () => {
    const base = tables.ru!;
    const problems: string[] = [];
    for (const [code, table] of Object.entries(tables)) {
      for (const key of Object.keys(base)) {
        if (!(key in table)) problems.push(`${code}: нет ключа ${key}`);
      }
      for (const [key, message] of Object.entries(table)) {
        const origin = base[key];
        if (origin === undefined) {
          problems.push(`${code}: лишний ключ ${key}`);
          continue;
        }
        if (typeof origin !== typeof message) problems.push(`${code}: ${key} — строка и формы вперемешку`);
        const mine = placeholders(message).join(',');
        const theirs = placeholders(origin).join(',');
        if (mine !== theirs) problems.push(`${code}: ${key} — подстановки {${mine}} против {${theirs}}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('формы числа — все, что язык требует, и никаких других; пустых строк нет', () => {
    const problems: string[] = [];
    for (const [code, table] of Object.entries(tables)) {
      const required = requiredForms(code);
      for (const [key, message] of Object.entries(table)) {
        if (typeof message === 'string') {
          if (message.trim() === '') problems.push(`${code}: ${key} пуст`);
          continue;
        }
        for (const [form, text] of Object.entries(message)) {
          if (!FORMS.has(form)) problems.push(`${code}: ${key} — формы «${form}» не бывает`);
          if (!text || text.trim() === '') problems.push(`${code}: ${key}.${form} пуст`);
        }
        for (const form of required) {
          if (!(form in message)) problems.push(`${code}: ${key} — нет формы «${form}»`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Разбор исходников: вызовы t/tn/tr и строки с кириллицей

const CYRILLIC = /[\u0400-\u04FF]/;

function walk(dir: string, extensions: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, extensions, out);
    else if (extensions.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

const rel = (path: string): string => relative(root, path).replace(/\\/g, '/');

interface Scan {
  /** Ключи, которые код зовёт буквально. */
  keys: { key: string; where: string }[];
  /** Вызовы, где ключ не строкой, — сверить их нельзя. */
  dynamic: string[];
  /** Строки с кириллицей — первые, для сообщения. */
  cyrillic: string[];
}

function lineOf(code: string, offset: number): number {
  return code.slice(0, offset).split('\n').length;
}

/** TypeScript — его же разборщиком: строки, шаблоны и вызовы. */
function scanTs(file: string, code: string, scan: Scan, offset = 0, whole = code): void {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (CYRILLIC.test(node.text)) scan.cyrillic.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      if (parts.some((part) => CYRILLIC.test(part))) scan.cyrillic.push(parts.join('…'));
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (name === 't' || name === 'tn') {
        const where = `${file}:${lineOf(whole, offset + node.getStart(source))}`;
        const first = node.arguments[0];
        if (first && ts.isStringLiteral(first)) scan.keys.push({ key: first.text, where });
        else scan.dynamic.push(where);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/**
 * Svelte — его же разборщиком: текст разметки, значения атрибутов
 * и выражения в `{…}`. Скрипт берётся отдельно и идёт через TypeScript.
 */
function scanSvelte(file: string, code: string, scan: Scan): void {
  for (const match of code.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    scanTs(file, match[1]!, scan, match.index! + match[0].indexOf(match[1]!), code);
  }
  const ast = parse(code, { modern: true });
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as Record<string, unknown> & { type?: string; start?: number };
    if (n.type === 'Comment') return;
    if (n.type === 'Text' && typeof n.data === 'string' && CYRILLIC.test(n.data)) scan.cyrillic.push(n.data.trim());
    if (n.type === 'Literal' && typeof n.value === 'string' && CYRILLIC.test(n.value)) scan.cyrillic.push(n.value);
    if (n.type === 'TemplateElement') {
      const cooked = (n.value as { cooked?: string } | undefined)?.cooked ?? '';
      if (CYRILLIC.test(cooked)) scan.cyrillic.push(cooked);
    }
    if (n.type === 'CallExpression') {
      const callee = n.callee as { type?: string; name?: string } | undefined;
      if (callee?.type === 'Identifier' && (callee.name === 't' || callee.name === 'tn')) {
        const first = (n.arguments as { type?: string; value?: unknown }[] | undefined)?.[0];
        const where = `${file}:${lineOf(code, n.start ?? 0)}`;
        if (first?.type === 'Literal' && typeof first.value === 'string') scan.keys.push({ key: first.value, where });
        else scan.dynamic.push(where);
      }
    }
    for (const [key, value] of Object.entries(n)) {
      if (key === 'parent' || key === 'metadata') continue;
      if (value && typeof value === 'object') visit(value);
    }
  };
  // Скрипт уже прошёл через TypeScript — здесь только разметка.
  visit(ast.fragment);
}

function scanFrontend(): Map<string, Scan> {
  const scans = new Map<string, Scan>();
  for (const path of walk(join(root, 'src'), ['.ts', '.svelte'])) {
    const file = rel(path);
    if (file.endsWith('.test.ts')) continue;
    const code = readFileSync(path, 'utf8');
    const scan: Scan = { keys: [], dynamic: [], cyrillic: [] };
    if (file.endsWith('.svelte')) scanSvelte(file, code, scan);
    else scanTs(file, code, scan);
    scans.set(file, scan);
  }
  return scans;
}

/**
 * Rust — простым автоматом: комментарии заменяются пробелами, строки
 * (обычные и сырые `r#"…"#`) собираются, знаки `'я'` пропускаются.
 * Модуль тестов в конце файла (`#[cfg(test)]` и следом `mod`) не смотрится:
 * строки тестов — не интерфейс.
 */
function scanRustSource(code: string): { stripped: string; literals: string[] } {
  const cut = code.search(/#\[cfg\(test\)\]\s*mod\s/);
  const body = cut >= 0 ? code.slice(0, cut) : code;
  let stripped = '';
  const literals: string[] = [];
  let i = 0;
  while (i < body.length) {
    const rest = body.slice(i, i + 12);
    if (rest.startsWith('//')) {
      const end = body.indexOf('\n', i);
      const stop = end < 0 ? body.length : end;
      stripped += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = body.indexOf('*/', i + 2);
      const stop = end < 0 ? body.length : end + 2;
      stripped += body.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    const raw = /^r(#*)"/.exec(rest);
    if (raw && !/[\w]/.test(body[i - 1] ?? '')) {
      const close = '"' + raw[1];
      const start = i + raw[0].length;
      const end = body.indexOf(close, start);
      const stop = end < 0 ? body.length : end + close.length;
      literals.push(body.slice(start, end < 0 ? body.length : end));
      stripped += body.slice(i, stop);
      i = stop;
      continue;
    }
    if (body[i] === '"') {
      let j = i + 1;
      while (j < body.length && body[j] !== '"') j += body[j] === '\\' ? 2 : 1;
      literals.push(body.slice(i + 1, j));
      stripped += body.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (body[i] === "'" && (body[i + 2] === "'" || body[i + 1] === '\\')) {
      const end = body.indexOf("'", i + 2);
      const stop = end < 0 ? body.length : end + 1;
      stripped += body.slice(i, stop);
      i = stop;
      continue;
    }
    stripped += body[i];
    i += 1;
  }
  return { stripped, literals };
}

function scanCore(): Map<string, Scan> {
  const scans = new Map<string, Scan>();
  for (const path of walk(join(root, 'src-tauri', 'src'), ['.rs'])) {
    const file = rel(path);
    const code = readFileSync(path, 'utf8');
    const { stripped, literals } = scanRustSource(code);
    const scan: Scan = { keys: [], dynamic: [], cyrillic: literals.filter((text) => CYRILLIC.test(text)) };
    // Сам модуль перевода зовёт свои функции с переменной — это их устройство.
    if (!file.endsWith('src/l10n.rs')) {
      for (const match of stripped.matchAll(/(?<![\w:]fn\s|\bfn\s)\b(?:l10n::)?(tr|tr_with|tr_n)\(\s*("?)([^"),\s]*)/g)) {
        const where = `${file}:${lineOf(stripped, match.index!)}`;
        if (match[2] === '"') scan.keys.push({ key: match[3]!, where });
        else scan.dynamic.push(where);
      }
    }
    scans.set(file, scan);
  }
  return scans;
}

describe('ключи в коде', () => {
  const front = scanFrontend();
  const core = scanCore();
  const all = [...front.values(), ...core.values()];

  it('ключ — только буквальной строкой: иначе его не сверить с таблицей', () => {
    expect(all.flatMap((scan) => scan.dynamic)).toEqual([]);
  });

  it('каждый ключ, который зовёт код, есть в таблице', () => {
    const missing = all.flatMap((scan) => scan.keys).filter(({ key }) => !(key in ru));
    expect(missing.map(({ key, where }) => `${where} ${key}`)).toEqual([]);
  });

  it('каждый ключ таблицы кто-то зовёт', () => {
    const used = new Set(all.flatMap((scan) => scan.keys.map(({ key }) => key)));
    expect(Object.keys(ru).filter((key) => !used.has(key))).toEqual([]);
  });

  it('сторож видит вызов с переменной и строку в скрипте Svelte', () => {
    // Проверка, которая не может провалиться, выглядит как проходящая.
    const scan: Scan = { keys: [], dynamic: [], cyrillic: [] };
    scanSvelte(
      'x.svelte',
      '<script lang="ts">\n  const k = "a";\n  const s = t(k) + "привет";\n</script>\n<p title={t(\'b\')}>текст</p>',
      scan,
    );
    expect(scan.dynamic).toEqual(['x.svelte:3']);
    expect(scan.keys.map(({ key }) => key)).toEqual(['b']);
    expect(scan.cyrillic.sort()).toEqual(['привет', 'текст']);

    const rust = scanRustSource(
      'fn a() { tr_with(key, &[]); tr("x.y"); } // "комментарий"\n' +
        'const S: &str = r#"сырая"#;\n#[cfg(test)]\nmod tests { const T: &str = "тест"; }',
    );
    expect(rust.literals).toEqual(['x.y', 'сырая']);
  });
});

// ---------------------------------------------------------------------------
// Сторож: русские строки — только в таблицах

/**
 * Где русская строка в коде законна навсегда — с причиной.
 *
 * Список держится коротким: каждая строка в нём — место, где человек
 * увидит русский текст в английском окне, если причина окажется неправдой.
 */
const ALLOWED_FRONT: Record<string, string> = {
  'src/l10n/index.ts': 'сообщение разработчику в консоль: строку попросили до выбора языка',
  'src/l10n/start.ts': 'сообщение разработчику: в сборке нет русской таблицы',
  'src/main.ts': 'отчёт стенда замеров и время готовности в консоли — для разработчика',
};

const ALLOWED_CORE: Record<string, string> = {
  'src-tauri/src/index/schema.rs': 'комментарии SQL внутри схемы индекса — их видит только SQLite',
};

/** Окно: стенд замеров — образцы текста и отчёт для разработчика. */
const SKIPPED_FRONT = ['src/bench/'];

/**
 * Файлы, ещё ждущие перевода, — список сокращают задачи 153–155,
 * к приёмке этапа он пуст. Файл, в котором русских строк не осталось,
 * тест требует отсюда убрать: иначе список перестал бы значить что-либо.
 */
const PENDING_FRONT: string[] = [
  'src/about.ts',
  'src/actions/about.ts',
  'src/actions/callouts.ts',
  'src/actions/clipboard.ts',
  'src/actions/drop-files.ts',
  'src/actions/encoding.ts',
  'src/actions/entries.ts',
  'src/actions/export.ts',
  'src/actions/external.ts',
  'src/actions/file-types.ts',
  'src/actions/files.ts',
  'src/actions/navigate.ts',
  'src/actions/paste-image.ts',
  'src/actions/print.ts',
  'src/actions/project.ts',
  'src/actions/rename-plan.ts',
  'src/actions/replace-plan.ts',
  'src/actions/replace.ts',
  'src/actions/templates.ts',
  'src/editor/code-blocks.ts',
  'src/editor/diagram.ts',
  'src/editor/folding.ts',
  'src/editor/images.ts',
  'src/editor/langs.ts',
  'src/editor/markdown-format.ts',
  'src/editor/note-title.ts',
  'src/editor/subpath.ts',
  'src/editor/tasks.ts',
  'src/editor/wikilinks.ts',
  'src/export/copy.ts',
  'src/export/html.ts',
  'src/export/pdf.ts',
  'src/html/convert.ts',
  'src/icons/registry.ts',
  'src/keymap/conflicts.ts',
  'src/keymap/global.svelte.ts',
  'src/state/links.svelte.ts',
  'src/state/modal.svelte.ts',
  'src/state/persist.svelte.ts',
  'src/state/roots.svelte.ts',
  'src/state/updates.svelte.ts',
  'src/theme/editor.ts',
  'src/ui/ImageView.svelte',
  'src/ui/Modal.svelte',
  'src/ui/NoticeStrip.svelte',
  'src/ui/PdfView.svelte',
  'src/ui/SearchPanel.svelte',
  'src/ui/Suggest.svelte',
  'src/ui/TabStrip.svelte',
  'src/ui/TitleBar.svelte',
  'src/ui/Toolbar.svelte',
  'src/ui/WindowControls.svelte',
  'src/ui/calendar.ts',
  'src/ui/download.ts',
  'src/ui/font-check.ts',
  'src/ui/menus.ts',
  'src/ui/palette/Palette.svelte',
  'src/ui/palette/query.ts',
  'src/ui/settings/AppearanceScreen.svelte',
  'src/ui/settings/CalloutsScreen.svelte',
  'src/ui/settings/FontsPanel.svelte',
  'src/ui/settings/KeysScreen.svelte',
  'src/ui/settings/SettingsScreen.svelte',
  'src/ui/settings/ThemeEditor.svelte',
  'src/ui/settings/ToolbarScreen.svelte',
  'src/ui/settings/attachments.ts',
  'src/ui/sidebar/Backlinks.svelte',
  'src/ui/sidebar/Bookmarks.svelte',
  'src/ui/sidebar/Calendar.svelte',
  'src/ui/sidebar/FileTree.svelte',
  'src/ui/sidebar/IconStrip.svelte',
  'src/ui/sidebar/Notes.svelte',
  'src/ui/sidebar/Outline.svelte',
  'src/ui/sidebar/ProjectSearch.svelte',
  'src/ui/sidebar/Sidebar.svelte',
  'src/ui/sidebar/Tags.svelte',
  'src/ui/welcome/WelcomeScreen.svelte',
  'src/ui/welcome/ago.ts',
];

const PENDING_CORE: string[] = [
  'src-tauri/src/callouts/edit.rs',
  'src-tauri/src/callouts/mod.rs',
  'src-tauri/src/clipboard.rs',
  'src-tauri/src/commands/appearance.rs',
  'src-tauri/src/commands/callouts.rs',
  'src-tauri/src/commands/edits.rs',
  'src-tauri/src/commands/entries.rs',
  'src-tauri/src/commands/export.rs',
  'src-tauri/src/commands/files.rs',
  'src-tauri/src/commands/index.rs',
  'src-tauri/src/commands/keymap.rs',
  'src-tauri/src/commands/layout.rs',
  'src-tauri/src/commands/notes.rs',
  'src-tauri/src/commands/roots.rs',
  'src-tauri/src/commands/session.rs',
  'src-tauri/src/commands/settings.rs',
  'src-tauri/src/commands/tree.rs',
  'src-tauri/src/commands/update.rs',
  'src-tauri/src/fsx/atomic_save.rs',
  'src-tauri/src/fsx/config.rs',
  'src-tauri/src/fsx/entry_ops.rs',
  'src-tauri/src/fsx/paths.rs',
  'src-tauri/src/fsx/recycle.rs',
  'src-tauri/src/fsx/reveal.rs',
  'src-tauri/src/fsx/text_edit.rs',
  'src-tauri/src/fsx/text_file.rs',
  'src-tauri/src/index/jobs.rs',
  'src-tauri/src/index/writer.rs',
  'src-tauri/src/keymap/edit.rs',
  'src-tauri/src/keymap/mod.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/src/markdown/attachment.rs',
  'src-tauri/src/markdown/daily.rs',
  'src-tauri/src/markdown/new_note.rs',
  'src-tauri/src/model/buffer.rs',
  'src-tauri/src/model/layout.rs',
  'src-tauri/src/model/root.rs',
  'src-tauri/src/pdf.rs',
  'src-tauri/src/project/ignore.rs',
  'src-tauri/src/project/mod.rs',
  'src-tauri/src/replace/matcher.rs',
  'src-tauri/src/session/mod.rs',
  'src-tauri/src/settings/edit.rs',
  'src-tauri/src/settings/mod.rs',
  'src-tauri/src/state.rs',
  'src-tauri/src/text/detect.rs',
  'src-tauri/src/text/encoding.rs',
  'src-tauri/src/theme/editor.rs',
  'src-tauri/src/theme/mod.rs',
  'src-tauri/src/tree/watch.rs',
];

/** Ядро: вывод стенда замеров — для разработчика, а не для человека в окне. */
const SKIPPED_CORE = ['src-tauri/src/bench.rs'];

describe('русские строки только в таблицах', () => {
  const front = scanFrontend();
  const core = scanCore();

  function check(scans: Map<string, Scan>, pending: string[], allowed: Record<string, string>, skipped: string[]) {
    const withRussian = [...scans.entries()]
      .filter(([file, scan]) => scan.cyrillic.length > 0 && !skipped.some((prefix) => file.startsWith(prefix)))
      .map(([file]) => file);
    const unexpected = withRussian
      .filter((file) => !pending.includes(file) && !(file in allowed))
      .map((file) => `${file}: «${scans.get(file)!.cyrillic[0]!.slice(0, 50)}»`);
    const done = pending.filter((file) => !withRussian.includes(file));
    return { unexpected, done };
  }

  it('окно', () => {
    const { unexpected, done } = check(front, PENDING_FRONT, ALLOWED_FRONT, SKIPPED_FRONT);
    expect(unexpected, 'русская строка мимо таблицы').toEqual([]);
    expect(done, 'переведено — убрать из PENDING_FRONT').toEqual([]);
  });

  it('ядро', () => {
    const { unexpected, done } = check(core, PENDING_CORE, ALLOWED_CORE, SKIPPED_CORE);
    expect(unexpected, 'русская строка мимо таблицы').toEqual([]);
    expect(done, 'переведено — убрать из PENDING_CORE').toEqual([]);
  });
});
