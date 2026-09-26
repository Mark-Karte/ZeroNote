import { LanguageDescription } from '@codemirror/language';
import type { Parser, SyntaxNode } from '@lezer/common';

import type { CalloutLookup } from '../editor/callouts';
import { isDiagram, withUniqueIds, type Drawn } from '../editor/diagram';
import { embedIsImage, localTarget } from '../editor/images';
import { languageById } from '../editor/langs';
import { languages } from '../editor/markdown-code';
import { fragmentParser, markdownSupport } from '../editor/markdown-language';
import { loadMath, mathSource, renderMath } from '../editor/math';
import { linkTarget, wikilinkSpans } from '../editor/wikilinks';
import { codeBlock, highlightedLines } from './code';
import { Renderer, blockBody, blockInfo, imageKey } from './markdown';
import { Source } from './source';

/**
 * Вывод HTML целиком: разбор, ресурсы, пределы (задача 108).
 *
 * Рендер (`markdown.ts`) синхронный и ничего не грузит. Здесь то, что
 * требует ожидания: языки блоков кода грузятся по требованию (Р-066),
 * байты картинок идут из ядра тем же путём, что у превью (Р-201).
 * Потребителей три — печать, экспорт и копирование, — и путь у них один.
 */

/**
 * Предел размера для вывода. Выше — отказ словами (инвариант 6).
 *
 * Разбор и сборка идут в потоке окна целиком, а не по видимой части, как
 * у превью. Замер задачи 108 (раздел 40): время растёт с размером прямо,
 * около 0,42 с на мебибайт и заметки, и кода. На пределе окно занято
 * меньше чем на полсекунды — заметно, но ещё не похоже на зависание;
 * на двух мебибайтах уже 0,85 с. Мебибайт заметки — это сотни страниц,
 * и печатать больше незачем. Упрощённый режим (свыше 50 МиБ) до этого
 * и не дойдёт.
 */
export const MARKDOWN_LIMIT = 1024 * 1024;
export const CODE_LIMIT = 1024 * 1024;

/**
 * Сколько байтов картинок встраивать в один документ. Картинка встаёт
 * строкой `data:` — на треть длиннее файла, — и документ с полусотней
 * снимков экрана иначе занял бы сотни мегабайт памяти окна. Сверх предела
 * картинка выходит подписью, и об этом сказано словами.
 */
export const IMAGES_LIMIT = 64 * 1024 * 1024;

/** Откуда брать то, чего нет в тексте. */
export interface ConvertContext {
  /** Как рисовать коллауты — список человека (задача 103). */
  callouts: CalloutLookup;
  /** Путь заметки: от её папки считаются пути картинок. `null` — не сохранена. */
  sourcePath: string | null;
  /** Картинка по пути → строка `data:`. По умолчанию — ядро (`previewImage`). */
  loadImage: (link: string, base: string | null) => Promise<string>;
  /** Картинка по имени `![[…]]` → строка `data:` (`previewEmbed`). */
  loadEmbed: (target: string, from: string) => Promise<string>;
  /**
   * Схема mermaid → SVG в цветах бумаги (задача 118). Зовётся, только если
   * схема в заметке есть: mermaid — самая крупная зависимость, и грузить
   * его ради заметки без схем незачем.
   */
  drawDiagram: (source: string) => Promise<Drawn>;
}

export interface Converted {
  html: string;
  /** Что не вошло: пропущенные картинки. Для человека, а не для документа. */
  problems: string[];
}

/** Слишком большой файл — отказ словами, а не долгая работа. */
export class TooLarge extends Error {}

/** Размер по-человечески: «2 МиБ». */
function mib(size: number): string {
  return `${Math.round((size / 1024 / 1024) * 10) / 10} МиБ`.replace('.', ',');
}

/**
 * Заметка markdown в HTML.
 *
 * `fragment` — текст не файл целиком, а кусок из его середины (выделение
 * при копировании): тогда frontmatter в нём не ищется — он бывает только
 * в начале файла.
 */
export async function markdownToHtml(
  text: string,
  context: ConvertContext,
  { fragment = false }: { fragment?: boolean } = {},
): Promise<Converted> {
  if (text.length > MARKDOWN_LIMIT) {
    throw new TooLarge(`заметка больше ${mib(MARKDOWN_LIMIT)} — такой объём вывод не собирает`);
  }

  // Frontmatter — узел того же разбора, что у превью (задача 114): рендер
  // его пропускает, а не отрезает строкой по своему правилу.
  const parser = fragment ? fragmentParser() : markdownSupport().language.parser;
  const tree = parser.parse(text);
  const spans = wikilinkSpans(text);
  const problems: string[] = [];

  // Блоки кода и картинки по дереву. Внутрь кода не спускаемся:
  // картинка в примере кода — это текст примера. Отдельно — где вставки
  // `![[…]]` не считаются: в коде, строчном коде и frontmatter. Служебное
  // поле не выводится, и грузить из него картинку незачем.
  const blocks: SyntaxNode[] = [];
  const verbatim: SyntaxNode[] = [];
  const formulas: SyntaxNode[] = [];
  const paths = new Set<string>();
  tree.iterate({
    enter(node) {
      if (node.name === 'InlineMath' || node.name === 'BlockMath') {
        formulas.push(node.node);
        verbatim.push(node.node);
        return false;
      }
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        blocks.push(node.node);
        verbatim.push(node.node);
        return false;
      }
      if (node.name === 'InlineCode' || node.name === 'Frontmatter') {
        verbatim.push(node.node);
        return false;
      }
      if (node.name === 'Image') {
        const url = node.node.getChild('URL');
        const link = url ? localTarget(text.slice(url.from, url.to)) : null;
        if (link !== null) paths.add(link);
      }
      return undefined;
    },
  });

  const insideVerbatim = (at: number): boolean =>
    verbatim.some((node) => at >= node.from && at < node.to);
  const embeds = new Set<string>();
  for (const span of spans) {
    const target = linkTarget(span.inner);
    if (span.embed && embedIsImage(target) && !insideVerbatim(span.from)) embeds.add(target);
  }

  const source = new Source(text);
  const code = await highlightBlocks(blocks, source);
  const math = await renderFormulas(formulas, text, problems);
  const diagrams = await drawDiagrams(blocks, source, context, problems);
  const images = await loadImages(paths, embeds, context, problems);

  const renderer = new Renderer(source, spans, { images, code, math, diagrams }, {
    callouts: context.callouts,
    links: true,
    missingImage: 'alt',
  });
  return { html: renderer.document(tree), problems };
}

/** Файл кода целиком: печать `.rs`, `.cpp`, `.txt`. */
export async function codeToHtml(
  text: string,
  languageId: string | null,
  /** С номерами строк — как на экране у этой вкладки. */
  numbered = false,
): Promise<Converted> {
  if (text.length > CODE_LIMIT) {
    throw new TooLarge(`файл больше ${mib(CODE_LIMIT)} — такой объём вывод не собирает`);
  }
  const language = languageById(languageId);
  const parser = language ? (await language.load()).language.parser : null;
  // Перевод строки в конце файла — признак конца, а не строка: без этого
  // на бумаге последней шла бы пустая строка со своим номером.
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return {
    html: codeBlock(highlightedLines(body, parser), language?.id ?? null, numbered),
    problems: [],
  };
}

/**
 * Раскрасить блоки кода их языками. Язык узнаётся тем же способом, что
 * у разбора markdown и у подписи блока (`languageLabel`): иначе на бумаге
 * блок был бы раскрашен одним языком, а на экране — другим.
 */
async function highlightBlocks(
  blocks: readonly SyntaxNode[],
  body: Source,
): Promise<Map<number, string>> {
  const parsers = new Map<string, Parser | null>();
  const out = new Map<number, string>();

  for (const block of blocks) {
    const info = blockInfo(block, body);
    let parser: Parser | null = null;
    if (info !== null) {
      if (!parsers.has(info)) {
        const match = LanguageDescription.matchLanguageName(languages, info, true);
        parsers.set(info, match ? (await match.load()).language.parser : null);
      }
      parser = parsers.get(info) ?? null;
    }
    out.set(block.from, codeBlock(highlightedLines(blockBody(block, body), parser), info));
  }

  return out;
}

/**
 * Формулы — разметкой MathML (задача 116). Temml грузится, только если
 * формула в документе есть: тот же кусок, что у превью, и та же таблица
 * стилей — печать и PDF ставят документ в это же окно и берут её оттуда.
 *
 * Неразобранная формула выходит как написана, и это называется: на бумаге
 * исходник TeX читается как опечатка, а не как решение.
 */
async function renderFormulas(
  formulas: readonly SyntaxNode[],
  text: string,
  problems: string[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (formulas.length === 0) return out;
  await loadMath();

  const read = (from: number, to: number): string => text.slice(from, to);
  for (const node of formulas) {
    const math = mathSource(read, node);
    const result = renderMath(math.tex, math.display);
    if (result === null) continue;
    if ('html' in result) out.set(node.from, result.html);
    else problems.push(`формула «${read(node.from, node.to)}» не разобрана — вышла как написана: ${result.error}`);
  }
  return out;
}

/**
 * Схемы mermaid — SVG в цветах бумаги (задача 118). Блок схемы тот же,
 * что у превью (`isDiagram`), и текст схемы тот же (`blockBody` — без
 * знаков цитаты у схемы в коллауте).
 *
 * Не нарисовалась — блок выходит кодом, как написан, и это называется:
 * на бумаге исходник схемы читается как недоделка, а причину — ошибку
 * разбора или предел размера — человек увидит только здесь. Первой
 * строкой: подробности mermaid с указателем на место ошибки показывает
 * превью.
 */
async function drawDiagrams(
  blocks: readonly SyntaxNode[],
  source: Source,
  context: ConvertContext,
  problems: string[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const block of blocks) {
    if (block.name !== 'FencedCode' || !isDiagram(blockInfo(block, source))) continue;
    const body = blockBody(block, source);
    // Пустой блок и превью не рисует: схемы в нём нет.
    if (body.trim() === '') continue;

    const result = await context.drawDiagram(body);
    if ('svg' in result) {
      // Свои имена у каждой вставки: та же схема может стоять на экране,
      // и при печати ссылки нашли бы её, скрытую (`withUniqueIds`).
      out.set(block.from, withUniqueIds(result.svg));
      continue;
    }
    const line = source.slice(0, block.from).split('\n').length;
    const reason = (result.error.split('\n')[0] ?? '').replace(/:$/, '');
    problems.push(`блок mermaid на строке ${line} вышел кодом — ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`);
  }
  return out;
}

/**
 * Байты картинок. По одной и по очереди, а не все разом: общий предел
 * (`IMAGES_LIMIT`) считается по мере загрузки, и картинка, которая в него
 * не влезла, не должна была и читаться.
 */
async function loadImages(
  paths: ReadonlySet<string>,
  embeds: ReadonlySet<string>,
  context: ConvertContext,
  problems: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let total = 0;
  let skipped = 0;

  const take = async (key: string, name: string, load: () => Promise<string>): Promise<void> => {
    if (total >= IMAGES_LIMIT) {
      skipped += 1;
      return;
    }
    try {
      const data = await load();
      if (total + data.length > IMAGES_LIMIT) {
        skipped += 1;
        return;
      }
      total += data.length;
      out.set(key, data);
    } catch (error) {
      problems.push(`картинка «${name}» не показана: ${String(error)}`);
    }
  };

  for (const link of paths) {
    await take(imageKey('path', link), link, () => context.loadImage(link, context.sourcePath));
  }
  for (const target of embeds) {
    const from = context.sourcePath;
    if (from === null) {
      problems.push(`картинка «${target}» не показана: заметка не сохранена, имя не по чему разрешать`);
      continue;
    }
    await take(imageKey('embed', target), target, () => context.loadEmbed(target, from));
  }

  if (skipped > 0) {
    problems.push(
      `картинок больше ${mib(IMAGES_LIMIT)} — ${skipped} вышли подписью вместо изображения`,
    );
  }
  return out;
}
