// Уведомления о сторонних компонентах: что чужого собрано в ZeroNote
// и под какими лицензиями (приёмка этапа 17).
//
//   npm run licenses
//
// Пишет THIRD-PARTY-NOTICES.md в корень репозитория. Файл лежит в git:
// установщик кладёт его рядом с программой (ресурс сборки Tauri), а сборка
// Tauri требует, чтобы ресурс существовал всегда — и в отладке тоже.
// Запускать при выпуске и при смене зависимостей; устаревший файл ловит
// tests/licenses.test.ts — по версиям пакетов и по версии программы.
//
// Лицензии MIT, ISC, BSD и Apache требуют приложить к копии программы
// уведомление об авторских правах и текст лицензии, EPL-2.0 — ещё и сказать,
// где взять исходники. Сборщик вырезает комментарии из кода, поэтому
// уведомления собираются отдельно:
//
// * библиотеки окна — ровно те, что попали в сборку фронтенда: их знает
//   сам vite (`build.license`), сборка идёт во временную папку;
// * крейты Rust — ровно те, что попадают в программу: обычные зависимости
//   для Windows, без зависимостей сборки и тестов и без процедурных
//   макросов (они работают при компиляции и в программу не входят).
//   Тексты — файлы лицензий из самих пакетов в реестре cargo;
// * шрифты и палитры встроенных тем — из репозитория.
//
// Одинаковые тексты (десятки копий Apache-2.0) печатаются один раз
// и называются номером.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'THIRD-PARTY-NOTICES.md');
const TARGET = 'x86_64-pc-windows-msvc';

/**
 * Файл лицензии в пакете: LICENSE, LICENSE-MIT, LICENSE_APACHE-2.0 (Tauri),
 * LICENSE.MIT (brotli), COPYING.txt, NOTICE… Разделители у пакетов разные.
 */
const LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicense)([-_.][\w.-]+)?$/i;
/** Не текст лицензии, хоть и назван так: код, описание SPDX. */
const NOT_TEXT = /\.(rs|toml|json|spdx|js|ts|py|sh)$/i;

/** Текст MIT без строки прав — для палитр тем, у которых строка своя. */
const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** Текст без различий в переносах и пустых краях — для сравнения копий. */
function normalize(text) {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

/** Библиотеки окна — по сборке фронтенда во временную папку. */
async function frontend() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeronote-licenses-'));
  try {
    await build({
      root,
      configFile: path.join(root, 'vite.config.ts'),
      logLevel: 'error',
      build: { outDir: dir, emptyOutDir: true, license: { fileName: 'licenses.json' } },
    });
    const list = JSON.parse(fs.readFileSync(path.join(dir, 'licenses.json'), 'utf8'));
    return list.map((item) => ({
      name: item.name,
      version: item.version,
      license: item.identifier ?? null,
      source: repository(path.join(root, 'node_modules', item.name, 'package.json')),
      texts: item.text ? [item.text] : [],
    }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Адрес исходников из package.json пакета. */
function repository(manifest) {
  try {
    const json = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const url = typeof json.repository === 'string' ? json.repository : json.repository?.url;
    if (!url) return null;
    if (/^[\w-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
    return url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
  } catch {
    return null;
  }
}

function cargo(args) {
  return execFileSync('cargo', args, {
    cwd: path.join(root, 'src-tauri'),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Крейты Rust, которые попадают в программу. */
function rust() {
  const tree = cargo([
    'tree', '-e', 'normal,no-proc-macro', '--target', TARGET,
    '--prefix', 'none', '--format', '{p}', '--offline',
  ]);
  const wanted = new Set();
  for (const line of tree.split('\n')) {
    const match = /^(\S+) v(\S+)/.exec(line.trim());
    if (match && match[1] !== 'zeronote') wanted.add(`${match[1]}@${match[2]}`);
  }

  const meta = JSON.parse(cargo(['metadata', '--format-version', '1', '--offline']));
  const out = [];
  for (const pkg of meta.packages) {
    const key = `${pkg.name}@${pkg.version}`;
    if (!wanted.has(key)) continue;
    wanted.delete(key);
    const dir = path.dirname(pkg.manifest_path);
    const files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name) && !NOT_TEXT.test(entry.name))
      .map((entry) => path.join(dir, entry.name));
    if (pkg.license_file) {
      const own = path.resolve(dir, pkg.license_file);
      if (!files.includes(own) && fs.existsSync(own)) files.push(own);
    }
    files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    out.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? null,
      source: pkg.repository ?? null,
      authors: pkg.authors ?? [],
      texts: files.map((file) => fs.readFileSync(file, 'utf8')),
    });
  }
  if (wanted.size > 0) throw new Error(`нет в cargo metadata: ${[...wanted].join(', ')}`);
  fillMissing(out);
  return out;
}

const BSD_3_BODY = `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

/**
 * Крейт без файла лицензии в пакете — текст по шаблону SPDX, правообладатели —
 * из описания пакета (`authors`), и это говорится прямо. Полный текст
 * Apache-2.0 без строки прав — берётся у соседнего крейта, где он есть.
 * Лицензия, для которой шаблона нет, останавливает скрипт: молча пропустить
 * её значило бы выпустить неполный файл.
 */
function fillMissing(items) {
  const apache = items
    .flatMap((item) => item.texts)
    .find((text) => text.includes('Apache License') && text.includes('Version 2.0, January 2004') && text.includes('TERMS AND CONDITIONS'));
  for (const item of items) {
    if (item.texts.length > 0) continue;
    const holders = item.authors.map((author) => author.replace(/\s*<[^>]*>/, '')).join(', ') || item.name;
    const ids = (item.license ?? '').split(/\s+(?:OR|AND)\s+|\//).map((id) => id.trim()).filter(Boolean);
    for (const id of ids) {
      if (id === 'MIT') item.texts.push(`MIT License\n\nCopyright (c) ${holders}\n\n${MIT_BODY}`);
      else if (id === 'BSD-3-Clause') item.texts.push(`BSD 3-Clause License\n\nCopyright (c) ${holders}\n\n${BSD_3_BODY}`);
      else if (id === 'Apache-2.0' && apache) item.texts.push(apache);
      else throw new Error(`${item.name} ${item.version}: текста нет, и для «${id}» шаблона нет`);
    }
    item.note = `Файла лицензии в пакете нет: текст — по шаблону SPDX, правообладатели — по описанию пакета (${holders}).`;
  }
}

/** Шрифты — файлы лицензий рядом со шрифтами. */
function fonts() {
  const dir = path.join(root, 'src', 'theme', 'fonts');
  const names = { 'LICENSE-ibm-plex.txt': 'IBM Plex Sans', 'LICENSE-jetbrains-mono.txt': 'JetBrains Mono' };
  return fs
    .readdirSync(dir)
    .filter((file) => file.startsWith('LICENSE-'))
    .map((file) => ({
      name: names[file] ?? file,
      license: 'OFL-1.1',
      source: null,
      texts: [fs.readFileSync(path.join(dir, file), 'utf8')],
    }));
}

/**
 * Палитры встроенных тем — по заголовкам файлов тем: имя в первой строке,
 * абзац об источнике — со знаком «©» и адресом.
 */
function palettes() {
  const dir = path.join(root, 'src-tauri', 'src', 'theme', 'builtin');
  const out = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);
    const name = /«(.+?)»/.exec(lines[0] ?? '')?.[1];
    const paragraph = [];
    for (const line of lines.slice(2)) {
      if (!line.startsWith('#') || line.trim() === '#') break;
      paragraph.push(line.replace(/^#\s?/, ''));
    }
    const text = paragraph.join(' ');
    const copyright = /©\s*([^,]+),\s*лицензия MIT/.exec(text)?.[1];
    if (!name || !copyright) continue;
    out.push({
      name,
      license: 'MIT',
      source: /https:\/\/\S+/.exec(text)?.[0] ?? null,
      note: text.replace(/https:\/\/\S+/, '').trim(),
      texts: [`MIT License\n\nCopyright © ${copyright.trim()}\n\n${MIT_BODY}`],
    });
  }
  return out;
}

/** Ограда для текста — длиннее любой цепочки обратных кавычек в нём. */
function fence(text) {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(longest + 1);
}

async function main() {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const sections = [
    ['Шрифты', fonts()],
    ['Палитры встроенных тем', palettes()],
    ['Библиотеки окна (JavaScript)', await frontend()],
    ['Библиотеки ядра (Rust)', rust()],
  ];

  // Одинаковые тексты — один раз, под номером.
  const numbers = new Map();
  const texts = [];
  const numberOf = (text) => {
    const key = normalize(text);
    if (!numbers.has(key)) {
      texts.push(key);
      numbers.set(key, texts.length);
    }
    return numbers.get(key);
  };

  // Абзац — одной строкой: файл читают в самом ZeroNote, и перенос
  // по ширине окна делает редактор. Ручные переносы на узкой колонке
  // ломались бы лесенкой.
  const out = [
    '# Уведомления о сторонних компонентах',
    '',
    'ZeroNote — свободная программа под лицензией MIT, © Mark Karte, исходные тексты — https://github.com/Mark-Karte/ZeroNote. В неё собраны чужие работы: шрифты, палитры тем, библиотеки окна и ядра. Их лицензии требуют приложить к копии программы уведомления об авторских правах и тексты лицензий — они здесь. Исходные тексты каждой библиотеки — по адресу у неё.',
    '',
    `Версия ZeroNote: ${version}. Файл собран скриптом \`scripts/licenses.mjs\`.`,
    '',
  ];

  for (const [title, items] of sections) {
    out.push(`## ${title} — ${items.length}`, '');
    for (const item of [...items].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`### ${item.name}${item.version ? ` ${item.version}` : ''}`, '');
      if (item.note) out.push(item.note, '');
      const refs = item.texts.map((text) => `№ ${numberOf(text)}`);
      const license = item.license ?? 'в описании пакета не указана';
      out.push(`Лицензия: ${license}.${refs.length > 0 ? ` Текст — ${refs.join(', ')}.` : ' Текста лицензии в пакете нет.'}`);
      if (item.source) out.push(`Исходники: ${item.source}`);
      out.push('');
    }
  }

  out.push(`## Тексты лицензий — ${texts.length}`, '');
  texts.forEach((text, index) => {
    const mark = fence(text);
    out.push(`### № ${index + 1}`, '', `${mark}text`, text, mark, '');
  });

  fs.writeFileSync(OUT, out.join('\n'), 'utf8');
  const count = sections.map(([title, items]) => `${title}: ${items.length}`).join('; ');
  console.log(`${path.relative(root, OUT)}: ${count}; текстов ${texts.length}; ${fs.statSync(OUT).size} байт`);
}

await main();
