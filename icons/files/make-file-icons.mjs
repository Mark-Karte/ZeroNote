// Значки типов файлов для проводника (задача 134, Р-302): рисунок и сборка `.ico`.
//
//   node icons/files/make-file-icons.mjs [--png <папка>]
//
// Итог — `src-tauri/icons/files/<расширение>.ico` на каждый тип из списка
// ассоциаций и `document.ico` для старого общего типа `ZeroNote.Document`,
// плюс `manifest.json`: какой вид и подпись у какого значка. Запускать
// только когда изменился рисунок или список — результат лежит
// в репозитории, сборка скрипт не зовёт (как `icons/make-icons.ps1`).
// `--png` дополнительно кладёт каждый кадр картинкой — для листа сравнения.
//
// Рисунок — здесь, кодом: полсотни расширений на восемь размеров не рисуют
// руками, иначе семья разъедется в мелочах. Мелкие размеры не уменьшаются
// с крупного, а рисуются каждый по своей сетке: края листа и полосы стоят
// ровно на границах пикселей, иначе на 16 px лист выходит мыльным.
//
// Растр делает Edge — тот же движок, что у окна приложения, — без новых
// зависимостей: страница рисует каждый SVG на холсте и выписывает пиксели
// в текст, скрипт забирает их из `--dump-dom` и собирает `.ico` сам.
//
// Список типов и вид каждого берутся из кода приложения, а не пишутся
// здесь второй раз: список — `src/actions/file-types.ts`, вид —
// `kindOf` из `src/icons/files.ts`, та же таблица, что красит дерево.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

import { TEXT_EXTENSIONS } from '../../src/actions/file-types.ts';
import { kindOf } from '../../src/icons/files.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'src-tauri', 'icons', 'files');

/**
 * Вид файла — цвет полосы. Виды те же, что в дереве, но цвет свой и один
 * на все темы: у проводника наших тем нет. Заметка — синий знака приложения,
 * темнее на ступень, чтобы белая подпись читалась; код — фиолетовый, темнее
 * синего, чтобы на 16 px их различала и яркость, а не только оттенок.
 */
const KINDS = {
  note: '#2279dc',
  code: '#7d40c8',
  data: '#c8641c',
  other: '#646c7a',
};

/**
 * Подпись — расширение заглавными; исключения — где расширение длинное
 * или у формата одно имя на два расширения.
 */
const LABELS = { markdown: 'MD', properties: 'PROP' };

/** Значок старого общего типа: лист без подписи, серый (задача 134). */
export const DOCUMENT = 'document';

/**
 * Размеры кадров. Кроме ряда знака приложения (16, 32, 48, 64, 256) —
 * 20, 24 и 40: их проводник берёт при масштабе экрана 125 и 150 %,
 * и без своего кадра уменьшает соседний с мылом.
 */
export const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

const PAGE = '#ffffff';
const FOLD = '#dfe3ea';
const EDGE = '#9ba2ae';
const LINE = '#cfd4dc';
const INK = '#ffffff';

/**
 * Сетка каждого размера, в пикселях: края листа, загиб, толщина черты,
 * полоса и подпись. Полоса выступает за левый край листа — так проводник
 * Windows 11 рисует значки документов, и так цвет виден даже на 16 px.
 *
 * `label`: `null` — без подписи (форма и цвет), `pixel` — точечный шрифт
 * (32 и 40: векторный текст там расплывается), число — наибольший кегль
 * Segoe UI; длинная подпись ужимается по ширине полосы.
 */
const GRID = {
  16: { page: [2, 14, 0, 16], fold: 4, stroke: 1, radius: 1, band: [1, 12, 8, 14], label: null, lines: 0 },
  20: { page: [3, 17, 0, 20], fold: 5, stroke: 1, radius: 1, band: [1, 15, 10, 17], label: null, lines: 0 },
  24: { page: [3, 21, 1, 23], fold: 6, stroke: 1, radius: 1, band: [1, 18, 12, 20], label: null, lines: 0 },
  32: { page: [5, 27, 1, 31], fold: 8, stroke: 1, radius: 2, band: [1, 26, 17, 26], label: 'pixel', lines: 3 },
  40: { page: [6, 34, 1, 39], fold: 9, stroke: 1, radius: 2, band: [2, 32, 21, 32], label: 'pixel', lines: 3 },
  48: { page: [7, 41, 2, 46], fold: 11, stroke: 1, radius: 3, band: [3, 37, 25, 38], label: 10, lines: 3 },
  64: { page: [10, 54, 2, 62], fold: 14, stroke: 2, radius: 4, band: [5, 49, 33, 51], label: 14, lines: 3 },
  256: { page: [40, 216, 10, 246], fold: 52, stroke: 4, radius: 16, band: [18, 198, 136, 212], label: 52, lines: 3 },
};

/**
 * Точечный шрифт подписи: пять точек в высоту, ширина по букве. Только
 * знаки, которые нужны подписям; незнакомый — ошибка, а не пропуск.
 */
const GLYPHS = {
  A: ['.1.', '1.1', '111', '1.1', '1.1'],
  B: ['11.', '1.1', '11.', '1.1', '11.'],
  C: ['111', '1..', '1..', '1..', '111'],
  D: ['111.', '1..1', '1..1', '1..1', '111.'],
  E: ['111', '1..', '11.', '1..', '111'],
  F: ['111', '1..', '11.', '1..', '1..'],
  G: ['111', '1..', '1.1', '1.1', '111'],
  H: ['1.1', '1.1', '111', '1.1', '1.1'],
  I: ['111', '.1.', '.1.', '.1.', '111'],
  J: ['..1', '..1', '..1', '1.1', '111'],
  K: ['1.1', '1.1', '11.', '1.1', '1.1'],
  L: ['1..', '1..', '1..', '1..', '111'],
  M: ['1...1', '11.11', '1.1.1', '1...1', '1...1'],
  N: ['1..1', '11.1', '1.11', '1..1', '1..1'],
  O: ['111', '1.1', '1.1', '1.1', '111'],
  P: ['111', '1.1', '111', '1..', '1..'],
  // Округлая, в отличие от квадратной O: квадратная с хвостом читается
  // строчной «q» — «SqL».
  Q: ['.11.', '1..1', '1..1', '1.11', '.111'],
  R: ['111', '1.1', '11.', '1.1', '1.1'],
  S: ['111', '1..', '111', '..1', '111'],
  T: ['111', '.1.', '.1.', '.1.', '.1.'],
  U: ['1.1', '1.1', '1.1', '1.1', '111'],
  V: ['1.1', '1.1', '1.1', '1.1', '.1.'],
  W: ['1...1', '1...1', '1.1.1', '1.1.1', '.1.1.'],
  X: ['1.1', '1.1', '.1.', '1.1', '1.1'],
  Y: ['1.1', '1.1', '.1.', '.1.', '.1.'],
  1: ['.1.', '11.', '.1.', '.1.', '111'],
};

/** Ширина точечной подписи с промежутками. */
function pixelWidth(text) {
  return [...text].reduce((sum, ch) => sum + glyph(ch)[0].length, 0) + text.length - 1;
}

function glyph(ch) {
  const found = GLYPHS[ch];
  if (!found) throw new Error(`нет точечного знака «${ch}»`);
  return found;
}

/** Точки подписи прямоугольниками, по центру полосы. */
function pixelLabel(text, band) {
  const [x0, x1, y0, y1] = band;
  const width = pixelWidth(text);
  if (width > x1 - x0 - 2) throw new Error(`подпись «${text}» шире полосы (${width} из ${x1 - x0})`);
  let x = x0 + Math.floor((x1 - x0 - width) / 2);
  const top = y0 + Math.floor((y1 - y0 - 5) / 2);

  const rects = [];
  for (const ch of text) {
    const rows = glyph(ch);
    rows.forEach((row, dy) => {
      [...row].forEach((dot, dx) => {
        if (dot === '1') rects.push(`<rect x="${x + dx}" y="${top + dy}" width="1" height="1"/>`);
      });
    });
    x += rows[0].length + 1;
  }
  return `<g fill="${INK}">${rects.join('')}</g>`;
}

/**
 * Контур листа с загибом. Черта рисуется внутрь: путь сдвинут на половину
 * её толщины, и край листа ложится ровно на границу пикселя.
 */
function pagePath(grid) {
  const [left, right, top, bottom] = grid.page;
  const h = grid.stroke / 2;
  const x0 = left + h;
  const x1 = right - h;
  const y0 = top + h;
  const y1 = bottom - h;
  const r = grid.radius;
  const f = grid.fold;
  return [
    `M${x0 + r} ${y0}`,
    `H${x1 - f}`,
    `L${x1} ${y0 + f}`,
    `V${y1 - r}`,
    `Q${x1} ${y1} ${x1 - r} ${y1}`,
    `H${x0 + r}`,
    `Q${x0} ${y1} ${x0} ${y1 - r}`,
    `V${y0 + r}`,
    `Q${x0} ${y0} ${x0 + r} ${y0}`,
    'Z',
  ].join(' ');
}

/** Загнутый угол: треугольник, прижатый к срезу листа. */
function foldPath(grid) {
  const [, right, top] = grid.page;
  const h = grid.stroke / 2;
  const x1 = right - h;
  const y0 = top + h;
  const f = grid.fold;
  return `M${x1 - f} ${y0} V${y0 + f} H${x1} Z`;
}

/**
 * Строки текста на листе — намёк на содержимое, с 32 px. Вид виден
 * и в них, ещё до подписи: у заметки первая строка — заголовок цвета
 * вида, у кода строки с отступом, у данных — «ключ = значение»,
 * у прочего — просто текст. Без полосы строки идут до низа листа.
 */
function contentLines(kind, grid, band) {
  if (!grid.lines) return '';
  const [left, right, top, bottom] = grid.page;
  const unit = (right - left) / 22;
  const thick = Math.max(1, Math.round(unit * 1.4));
  const gap = Math.max(3, Math.round(unit * 3.2));
  const inset = Math.max(4, Math.round(unit * 4));
  const x0 = left + inset;
  const x1 = right - inset;
  // Первая строка — рядом с загибом, а не под ним, и до него не доходит.
  const beforeFold = right - grid.fold - Math.max(2, Math.round(unit * 2));
  const limit = (band ? grid.band[2] : bottom) - Math.max(2, Math.round(unit * 2.5));
  const count = band ? grid.lines : grid.lines * 3;

  const rect = (x, y, w, h, color) =>
    `<rect x="${x}" y="${y}" width="${Math.max(1, w)}" height="${h}" fill="${color}"/>`;
  // Строки разной длины: ряд одинаковых полос читается штриховкой, а не текстом.
  const lengths = [1, 0.8, 0.9];

  const out = [];
  let y = top + Math.round(grid.fold * 0.6);
  for (let i = 0; i < count && y + thick <= limit; i++, y += gap) {
    const end = i === 0 ? beforeFold : x0 + Math.round((x1 - x0) * lengths[i % lengths.length]);
    if (kind === 'note' && i === 0) {
      const h = thick > 1 ? thick + 1 : thick;
      out.push(rect(x0, y, Math.round((end - x0) * 0.8), h, KINDS.note));
    } else if (kind === 'code' && i > 0) {
      const indent = Math.max(2, Math.round(unit * 3));
      out.push(rect(x0 + indent, y, end - x0 - indent, thick, LINE));
    } else if (kind === 'data') {
      const key = Math.max(2, Math.round((end - x0) * 0.35));
      const space = Math.max(1, Math.round(unit * 2));
      out.push(rect(x0, y, key, thick, LINE), rect(x0 + key + space, y, end - x0 - key - space, thick, LINE));
    } else {
      out.push(rect(x0, y, end - x0, thick, LINE));
    }
  }
  return out.join('');
}

/**
 * Рисунок одного кадра: SVG без векторной подписи и, отдельно, место
 * для неё — её рисует холст, чтобы ужать по ширине полосы по замеру.
 */
export function frameFor(type, size) {
  const grid = GRID[size];
  if (!grid) throw new Error(`нет сетки для ${size} px`);
  const [bx0, bx1, by0, by1] = grid.band;
  const bandRadius = Math.max(1, Math.round(grid.radius * 0.8));
  const hasLabel = type.band && type.label !== null && grid.label !== null;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<path d="${pagePath(grid)}" fill="${PAGE}" stroke="${EDGE}" stroke-width="${grid.stroke}" stroke-linejoin="round"/>`,
    `<path d="${foldPath(grid)}" fill="${FOLD}" stroke="${EDGE}" stroke-width="${grid.stroke}" stroke-linejoin="round"/>`,
    contentLines(type.kind, grid, type.band),
    type.band
      ? `<rect x="${bx0}" y="${by0}" width="${bx1 - bx0}" height="${by1 - by0}" rx="${bandRadius}" fill="${KINDS[type.kind]}"/>`
      : '',
    hasLabel && grid.label === 'pixel' ? pixelLabel(type.label, grid.band) : '',
    '</svg>',
  ].join('');

  const text =
    hasLabel && typeof grid.label === 'number'
      ? { text: type.label, size: grid.label, band: grid.band, pad: Math.max(2, Math.round(size / 16)) }
      : null;
  return { svg, text };
}

/** Какие значки собирать: тип из списка ассоциаций плюс общий лист. */
export function iconTypes() {
  const types = TEXT_EXTENSIONS.map((ext) => ({
    name: ext,
    kind: kindOf(`x.${ext}`),
    label: LABELS[ext] ?? ext.toUpperCase(),
    band: true,
  }));
  // Общий лист — без полосы: пустая полоса читается заготовкой,
  // а не документом.
  types.push({ name: DOCUMENT, kind: 'other', label: null, band: false });
  return types;
}

/**
 * Страница, которая рисует все кадры и выписывает их в текст: пиксели
 * RGBA (из них собирается `.ico`) и PNG каждого — для листа сравнения.
 */
function rasterPage(frames) {
  return `<!doctype html><meta charset="utf-8"><body><pre id="out"></pre><script>
const frames = ${JSON.stringify(frames)};
const out = [];
let left = frames.length;

function label(ctx, t) {
  const [x0, x1, y0, y1] = t.band;
  let px = t.size;
  const room = x1 - x0 - 2 * t.pad;
  ctx.fillStyle = '${INK}';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Длинная подпись ужимается кеглем, а не обрезается.
  for (;;) {
    ctx.font = '700 ' + px + 'px "Segoe UI"';
    if (ctx.measureText(t.text).width <= room || px <= 6) break;
    px -= 0.5;
  }
  // По середине полосы — высота заглавной, а не строки: подписи заглавные.
  const cap = ctx.measureText('H').actualBoundingBoxAscent;
  ctx.fillText(t.text, (x0 + x1) / 2, Math.round((y0 + y1) / 2 + cap / 2));
}

for (const frame of frames) {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = frame.size;
    canvas.height = frame.size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    if (frame.text) label(ctx, frame.text);
    const png = canvas.toDataURL('image/png').split(',')[1];
    const data = ctx.getImageData(0, 0, frame.size, frame.size).data;
    let bin = '';
    for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
    out.push(frame.name + ' ' + frame.size + ' ' + png + ' ' + btoa(bin));
    if (--left === 0) document.getElementById('out').textContent = out.join('\\n') + '\\nDONE';
  };
  img.onerror = () => { document.getElementById('out').textContent = 'FAILED ' + frame.name + ' ' + frame.size; };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(frame.svg);
}
</script>`;
}

/** Edge стоит в Windows 10 и 11 всегда, но папка у него бывает любая из двух. */
function edgePath() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('не найден msedge.exe');
  return found;
}

/** Отрисовать кадры в Edge; итог — `{name, size, png, raw}` на каждый. */
function rasterize(frames) {
  const work = join(tmpdir(), `zeronote-file-icons-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const page = join(work, 'raster.html');
  writeFileSync(page, rasterPage(frames));

  let dom;
  try {
    dom = execFileSync(
      edgePath(),
      [
        '--headless=new',
        '--disable-gpu',
        `--user-data-dir=${join(work, 'profile')}`,
        '--virtual-time-budget=20000',
        '--dump-dom',
        pathToFileURL(page).href,
      ],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const start = dom.indexOf('<pre id="out">') + '<pre id="out">'.length;
  const lines = dom.slice(start, dom.indexOf('</pre>', start)).split('\n');
  if (lines.at(-1) !== 'DONE') throw new Error(`Edge не дорисовал кадры: ${lines.at(-1)}`);
  return lines.slice(0, -1).map((line) => {
    const [name, size, png, raw] = line.split(' ');
    return { name, size: Number(size), png: Buffer.from(png, 'base64'), raw: Buffer.from(raw, 'base64') };
  });
}

/**
 * Кадр точечным рисунком — как его хранит `.ico`: BMP без заголовка файла,
 * высота удвоена (за цветом идёт маска), строки снизу вверх, BGRA.
 * Устройство то же, что у знака приложения в `icons/make-icons.ps1`.
 */
function bitmapFrame(size, rgba) {
  const maskRow = Math.ceil(size / 32) * 4;
  const out = Buffer.alloc(40 + size * size * 4 + maskRow * size);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(size, 4);
  out.writeInt32LE(size * 2, 8);
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(0, 16);
  out.writeUInt32LE(size * size * 4, 20);

  let at = 40;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      out[at++] = rgba[i + 2];
      out[at++] = rgba[i + 1];
      out[at++] = rgba[i];
      out[at++] = rgba[i + 3];
    }
  }
  // Маска прозрачности: единица — «не рисовать». У 32-битного кадра
  // прозрачность уже в альфа-канале, но старые пути отрисовки читают маску.
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      if (rgba[(y * size + x) * 4 + 3] < 128) out[at + (x >> 3)] |= 0x80 >> (x & 7);
    }
    at += maskRow;
  }
  return out;
}

/**
 * Кадр 256 — PNG с палитрой, а не полноцветный, какой отдаёт холст.
 *
 * Полноцветный весит 6–8 КиБ, и на полсотни значков это 400 КиБ
 * установщика, которые LZMA уже не ужмёт: PNG сжат. С палитрой кадр
 * меньше в разы. Цветов в рисунке — плоские заливки и их сглаженные
 * края, до трёхсот с небольшим; в палитру идут 256 самых частых, редкий
 * край получает ближайший из них — на глаз разницы нет.
 */
function palettePng(size, rgba) {
  const counts = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const key = rgba.readUInt32BE(i);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const palette = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map(([key]) => key);
  const index = new Map(palette.map((key, i) => [key, i]));
  const channels = (key) => [key >>> 24, (key >>> 16) & 255, (key >>> 8) & 255, key & 255];
  const nearest = (key) => {
    const [r, g, b, a] = channels(key);
    let best = 0;
    let bestDistance = Infinity;
    palette.forEach((candidate, i) => {
      const [r2, g2, b2, a2] = channels(candidate);
      const distance = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2 + (a - a2) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    index.set(key, best);
    return best;
  };

  // Строки с байтом фильтра «без фильтра» впереди: у палитры фильтры
  // по соседям не помогают, а сжатие и так берёт повторы.
  const rows = Buffer.alloc((size + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const key = rgba.readUInt32BE((y * size + x) * 4);
      rows[y * (size + 1) + 1 + x] = index.get(key) ?? nearest(key);
    }
  }

  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // бит на точку
  ihdr[9] = 3; // цвет по палитре
  const plte = Buffer.from(palette.flatMap((key) => channels(key).slice(0, 3)));
  const trns = Buffer.from(palette.map((key) => key & 255));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Кадр в том виде, в каком он ляжет в `.ico`. */
function stored(frame) {
  return frame.size < 256 ? bitmapFrame(frame.size, frame.raw) : palettePng(frame.size, frame.raw);
}

/** Собрать `.ico`: кадры меньше 256 — точечным рисунком, 256 — PNG с палитрой. */
function icoFile(frames) {
  const sorted = [...frames].sort((a, b) => a.size - b.size);
  const images = sorted.map(stored);
  const header = Buffer.alloc(6 + 16 * sorted.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sorted.length, 4);
  let offset = header.length;
  sorted.forEach((f, i) => {
    const at = 6 + i * 16;
    header[at] = f.size >= 256 ? 0 : f.size;
    header[at + 1] = f.size >= 256 ? 0 : f.size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(images[i].length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

function main() {
  const pngDir = process.argv.includes('--png') ? process.argv[process.argv.indexOf('--png') + 1] : null;
  const types = iconTypes();

  const frames = [];
  for (const type of types) {
    for (const size of SIZES) {
      frames.push({ name: type.name, size, ...frameFor(type, size) });
    }
  }
  const drawn = rasterize(frames);
  if (drawn.length !== frames.length) throw new Error(`кадров ${drawn.length}, а нужно ${frames.length}`);

  // Прошлый набор убирается целиком: значок убранного из списка типа
  // не должен остаться лежать и попасть в установщик.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  if (pngDir) mkdirSync(pngDir, { recursive: true });

  const manifest = {};
  for (const type of types) {
    const own = drawn.filter((f) => f.name === type.name);
    writeFileSync(join(OUT, `${type.name}.ico`), icoFile(own));
    manifest[type.name] = { kind: type.kind, label: type.label };
    // Для листа сравнения — кадр 256 тот же, что в `.ico`, с палитрой.
    if (pngDir) {
      for (const f of own) writeFileSync(join(pngDir, `${f.name}-${f.size}.png`), f.size < 256 ? f.png : stored(f));
    }
  }
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${types.length} значков в ${OUT}: ${readdirSync(OUT).length - 1} файлов .ico`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
