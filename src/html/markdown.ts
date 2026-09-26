import type { SyntaxNode, Tree } from '@lezer/common';

import { icon } from '../icons/registry';
import { parseCallout, type CalloutLookup } from '../editor/callouts';
import { embedIsImage, localTarget } from '../editor/images';
import { isBreak, pairTags, readTag, type PlacedTag } from '../editor/inline-html';
import { taskState } from '../editor/tasks';
import { linkTarget, type WikilinkSpan } from '../editor/wikilinks';
import { codeBlock, fencedBody, highlightedLines, indentedBody } from './code';
import { escapeHtml, safeHref } from './escape';
import type { Source } from './source';

/**
 * Markdown в HTML — обходом того же дерева разбора, что у превью (задача 108).
 *
 * Готовые преобразователи (`marked`, `markdown-it`) читают по-своему
 * `==выделение==`, коллауты и `[[ссылки]]`, и вывод разошёлся бы с превью
 * молча. Здесь обход дерева, которое и так строит редактор, и правило одно:
 * **напечатанное показывает то же, что превью**, только без правила строки
 * под курсором.
 *
 * Этот модуль синхронный и ничего не грузит: картинки и раскрашенный код
 * приходят готовыми в `Resources`. Собирает их обёртка `convert.ts` —
 * так рендер проверяется тестом без ядра и без загрузки языков.
 */

/** Что приготовлено заранее: байты картинок и раскрашенный код. */
export interface Resources {
  /** Картинка по ключу `imageKey` → строка `data:`. */
  images: ReadonlyMap<string, string>;
  /** Блок кода по смещению его узла → строки `highlightedLines`. */
  code: ReadonlyMap<number, string>;
}

export interface RenderOptions {
  /** Как рисовать коллауты — список человека (задача 103). */
  callouts: CalloutLookup;
  /**
   * Делать ли ссылки ссылками. Превью таблицы — нет: щелчок по `<a>`
   * в окне приложения увёл бы само окно по адресу.
   */
  links: boolean;
  /**
   * Чем заменить картинку, которой нет в ресурсах: подписью — в выводе
   * для чужих глаз, исходником — в превью, где отсутствие видно сразу
   * и правится там же.
   */
  missingImage: 'alt' | 'source';
}

/** Как выровнен столбец. `null` — как получится, то есть по левому краю. */
export type Align = 'left' | 'center' | 'right' | null;

/**
 * Как записано выравнивание в разделительной строке.
 *
 * `|:---|:--:|---:|` — левое, по центру, правое. Чистая функция: правило
 * маленькое, а ошибиться в двоеточиях легко. Живёт здесь, а не у превью
 * таблицы, потому что нужна обоим: превью берёт отсюда и её, и ячейки.
 */
export function alignmentsFrom(delimiter: string): Align[] {
  const parts = delimiter.trim().split('|');
  // Крайние пустые куски — от палок по краям строки, а не столбцы. Палки
  // по краям GFM не требует: `:--|--:` — тоже два столбца.
  if (parts[0]?.trim() === '') parts.shift();
  if (parts.length > 0 && parts[parts.length - 1]!.trim() === '') parts.pop();

  return parts.map((part): Align => {
      const text = part.trim();
      const left = text.startsWith(':');
      const right = text.endsWith(':');

      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return null;
    });
}

/** Ключ картинки: вставка по имени и ссылка по пути разрешаются по-разному. */
export function imageKey(kind: 'embed' | 'path', target: string): string {
  return `${kind}:${target}`;
}

/** Вики-ссылка вместе с `!` у вставки — так она занимает текст. */
function spanFrom(span: WikilinkSpan): number {
  return span.embed ? span.from - 1 : span.from;
}

/**
 * Состояние одного прохода: исходник, ресурсы и найденные вики-ссылки.
 *
 * Класс, а не пачка параметров у каждой функции: рекурсия по дереву идёт
 * в двух десятках мест, и тащить через все пять одинаковых аргументов —
 * верный способ перепутать их местами.
 */
export class Renderer {
  constructor(
    private readonly source: Source,
    /** Вики-ссылки по всему документу, по возрастанию смещения. */
    private readonly spans: readonly WikilinkSpan[],
    private readonly resources: Resources,
    private readonly options: RenderOptions,
  ) {}

  /** Документ целиком. */
  document(tree: Tree): string {
    return this.blocks(tree.topNode);
  }

  // ---------------------------------------------------------------- блоки

  /** Дочерние блоки узла по порядку. */
  private blocks(parent: SyntaxNode, skip?: SyntaxNode): string {
    const out: string[] = [];
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (skip && child.from === skip.from && child.name === skip.name) continue;
      const html = this.block(child, false);
      if (html !== '') out.push(html);
    }
    return out.join('\n');
  }

  private block(node: SyntaxNode, tight: boolean): string {
    const name = node.name;

    if (name === 'Paragraph') {
      const inner = this.inline(node, node.from, node.to);
      return tight ? inner : `<p>${inner}</p>`;
    }

    const atx = /^ATXHeading([1-6])$/.exec(name);
    if (atx) return this.atxHeading(node, Number(atx[1]));

    const setext = /^SetextHeading([12])$/.exec(name);
    if (setext) {
      // Подчёркивание `===` на своей строке: текст кончается перед её
      // переносом, иначе он вышел бы лишним `<br>` в конце заголовка.
      const mark = node.getChild('HeaderMark');
      const end = mark ? Math.max(node.from, this.source.lastIndexOf('\n', mark.from)) : node.to;
      return `<h${setext[1]}>${this.inline(node, node.from, end).trim()}</h${setext[1]}>`;
    }

    switch (name) {
      case 'Blockquote':
        return this.quote(node);
      case 'BulletList':
      case 'OrderedList':
        return this.list(node);
      case 'FencedCode':
      case 'CodeBlock':
        // Раскрашенный код готовит обёртка: языки грузятся по требованию.
        // Нет его — тот же блок без раскраски, а не пустое место.
        return (
          this.resources.code.get(node.from) ??
          codeBlock(highlightedLines(blockBody(node, this.source), null), blockInfo(node, this.source))
        );
      case 'HorizontalRule':
        return '<hr>';
      case 'Table':
        return this.table(node);
      case 'BlockMath':
        // Формула на бумаге — задача 116. До неё — как написано, а не
        // пустое место: исчезнувшая формула хуже формулы исходником.
        return `<p class="zn-source">${escapeHtml(this.text(node.from, node.to))}</p>`;
      case 'HTMLBlock':
        // Сырой HTML блоком — текстом, как его показывает превью. Строки
        // сохраняются: это чаще всего разметка, и склеенная в одну строку
        // она не читается.
        return `<p class="zn-source">${escapeHtml(this.text(node.from, node.to))}</p>`;
      // Служебное, а не текст: служебные поля файла (Р-264, узел —
      // с задачи 114), комментарий автора, определение ссылки, знак
      // цитаты между блоками.
      case 'Frontmatter':
      case 'CommentBlock':
      case 'ProcessingInstructionBlock':
      case 'LinkReference':
      case 'QuoteMark':
        return '';
      default:
        return '';
    }
  }

  private atxHeading(node: SyntaxNode, level: number): string {
    const marks = node.getChildren('HeaderMark');
    const from = marks[0] ? marks[0].to : node.from;
    // Закрывающие решётки `## Заголовок ##` — тоже знак, а не текст.
    const last = marks.length > 1 ? marks[marks.length - 1]! : null;
    const to = last && last.from > from ? last.from : node.to;
    return `<h${level}>${this.inline(node, from, to).trim()}</h${level}>`;
  }

  /**
   * Цитата или коллаут.
   *
   * Коллаут — цитата, первая строка которой `[!тип] Заголовок` (Р-177).
   * Карточка: значок и заголовок строкой, тело ниже. Своих слов вывод
   * не сочиняет (Р-178): коллаут без заголовка — один значок.
   */
  private quote(node: SyntaxNode): string {
    const lineEnd = this.source.indexOf('\n', node.from);
    const firstLine = this.text(node.from, lineEnd < 0 ? node.to : lineEnd);
    const marker = parseCallout(firstLine);
    if (!marker) return `<blockquote>\n${this.blocks(node)}\n</blockquote>`;

    const style = this.options.callouts(marker.type);
    const titleFrom = node.from + marker.to;
    const titleTo = lineEnd < 0 || lineEnd > node.to ? node.to : lineEnd;

    // Заголовок — остаток первой строки первого абзаца; остальные строки
    // этого абзаца — уже тело. Разбор видит их одним абзацем.
    const first = node.getChild('Paragraph');
    let title = '';
    let rest = '';
    if (first && first.from <= titleFrom && first.to >= titleFrom) {
      title = this.inline(first, titleFrom, Math.min(titleTo, first.to)).trim();
      if (first.to > titleTo) {
        const body = this.inline(first, titleTo + 1, first.to).trim();
        if (body !== '') rest = `<p>${body}</p>`;
      }
    }

    const body = [rest, this.blocks(node, first ?? undefined)].filter((part) => part !== '');
    const heading =
      `<div class="zn-callout-title"><span class="zn-callout-icon">${icon(style.icon)}</span>` +
      `${title === '' ? '' : `<span>${title}</span>`}</div>`;

    return (
      `<div class="zn-callout" style="--callout-color: ${calloutColor(style.color)}">` +
      `${heading}${body.length > 0 ? `\n<div class="zn-callout-body">\n${body.join('\n')}\n</div>` : ''}` +
      `</div>`
    );
  }

  /**
   * Список. Тесный — без абзацев в пунктах, свободный — с ними, как велит
   * CommonMark: свободный тот, где между пунктами или внутри пункта между
   * блоками стоит пустая строка.
   */
  private list(node: SyntaxNode): string {
    const items = node.getChildren('ListItem');
    const tight = !this.loose(items);

    let open = node.name === 'OrderedList' ? '<ol>' : '<ul>';
    if (node.name === 'OrderedList' && items[0]) {
      const mark = items[0].getChild('ListMark');
      const start = mark ? Number.parseInt(this.text(mark.from, mark.to), 10) : 1;
      if (Number.isFinite(start) && start !== 1) open = `<ol start="${start}">`;
    }

    const html = items.map((item) => this.listItem(item, tight));
    const close = node.name === 'OrderedList' ? '</ol>' : '</ul>';
    return `${open}\n${html.join('\n')}\n${close}`;
  }

  /** Есть ли пустая строка между соседними пунктами или блоками пункта. */
  private loose(items: readonly SyntaxNode[]): boolean {
    const blank = (from: number, to: number): boolean => /\n[ \t>]*\n/.test(this.text(from, to));

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      const next = items[index + 1];
      if (next && blank(item.to, next.from)) return true;

      let previous: SyntaxNode | null = null;
      for (let child = item.firstChild; child; child = child.nextSibling) {
        if (child.name === 'ListMark') continue;
        if (previous && blank(previous.to, child.from)) return true;
        previous = child;
      }
    }
    return false;
  }

  private listItem(item: SyntaxNode, tight: boolean): string {
    const parts: string[] = [];
    let task: 'open' | 'done' | null = null;

    for (let child = item.firstChild; child; child = child.nextSibling) {
      if (child.name === 'ListMark') continue;
      if (child.name === 'Task') {
        const rendered = this.task(child, tight);
        task = rendered.done ? 'done' : 'open';
        parts.push(rendered.html);
        continue;
      }
      parts.push(child.name.endsWith('List') ? this.list(child) : this.block(child, tight));
    }

    // Класс у пункта-задачи: стиль документа убирает у него маркер списка —
    // на его месте значок.
    const cls =
      task === null ? '' : ` class="zn-task-item${task === 'done' ? ' zn-task-item-done' : ''}"`;
    return `<li${cls}>${parts.filter((part) => part !== '').join('\n')}</li>`;
  }

  /** Задача: значок из реестра вместо `[ ]`, как в превью (задача 91). */
  private task(node: SyntaxNode, tight: boolean): { html: string; done: boolean } {
    const marker = node.getChild('TaskMarker');
    const state = marker ? taskState(this.text(marker.from, marker.to)) : null;
    const done = state === 'done';

    const from = marker ? marker.to : node.from;
    const text = this.inline(node, from, node.to).trim();
    const box = `<span class="zn-task">${icon(done ? 'md.task-done' : 'md.task-open')}</span>`;
    const body = done ? `<span class="zn-task-text-done">${text}</span>` : text;
    const html = `${box} ${body}`;
    return { html: tight ? html : `<p>${html}</p>`, done };
  }

  private table(node: SyntaxNode): string {
    // Строка `|:--|--:|` — прямой ребёнок таблицы; у строк свои разделители.
    const delimiter = node.getChild('TableDelimiter');
    const align = delimiter ? alignmentsFrom(this.text(delimiter.from, delimiter.to)) : [];

    const header = node.getChild('TableHeader');
    const rows = node.getChildren('TableRow');
    const width = header ? this.cells(header).length : 0;

    const row = (line: SyntaxNode, tag: 'th' | 'td'): string => {
      const cells = this.cells(line).map((cell) => cell.html);
      // Рваная строка — по правилу GFM: короче заголовка — дополняется
      // пустыми ячейками (браузер столбцы сам не достраивает), длиннее —
      // лишнее отбрасывается. Чаще всего лишнее — это `[[цель|подпись]]`,
      // разрезанная палкой; в таблице подпись пишут `\|`.
      if (width > 0) cells.length = Math.min(cells.length, width);
      while (cells.length < width) cells.push('');
      const html = cells.map((cell, index) => `<${tag}${alignAttr(align[index])}>${cell}</${tag}>`);
      return `<tr>${html.join('')}</tr>`;
    };

    const head = header ? `<thead>\n${row(header, 'th')}\n</thead>\n` : '';
    const body = rows.map((line) => row(line, 'td')).join('\n');
    return `<table>\n${head}<tbody>\n${body}\n</tbody>\n</table>`;
  }

  /**
   * Ячейки строки таблицы по разделителям, а не по узлам ячеек: у пустой
   * ячейки узла нет вовсе, и счёт по узлам сдвинул бы столбцы.
   *
   * Открыт наружу ради превью таблицы (`editor/tables.ts`): ячейку там
   * рисует этот же вывод, и строчная разметка в сетке та же, что на бумаге.
   * `at` — где ячейка начинается в документе: туда щелчок ставит курсор.
   */
  cells(line: SyntaxNode): Array<{ at: number; html: string }> {
    const bounds = [line.from];
    for (const delimiter of line.getChildren('TableDelimiter')) {
      bounds.push(delimiter.from, delimiter.to);
    }
    bounds.push(line.to);

    const cells: Array<{ at: number; html: string }> = [];
    const found = line.getChildren('TableCell');
    for (let index = 0; index + 1 < bounds.length; index += 2) {
      const from = bounds[index]!;
      const to = bounds[index + 1]!;
      const cell = found.find((candidate) => candidate.from >= from && candidate.to <= to);
      // Палка в начале и в конце строки — рамка, а не пустые столбцы.
      const edge = (index === 0 || index + 2 >= bounds.length) && this.text(from, to).trim() === '';
      if (edge && !cell) continue;
      cells.push(
        cell
          ? { at: cell.from, html: this.inline(cell, cell.from, cell.to).trim() }
          : { at: from, html: '' },
      );
    }
    return cells;
  }

  // ------------------------------------------------------------ строчное

  /**
   * Строчное содержимое узла в отрезке `[from, to)`.
   *
   * Дети, попавшие в отрезок целиком, выводятся своими правилами, текст
   * между ними — экранированным. Вики-ссылки лежат поверх дерева (Р-175):
   * разбор видит внутри `[[Заметка]]` обычную ссылку `[Заметка]`, поэтому
   * ссылка, чьи границы не режут детей пополам, выводится своим правилом,
   * а дети внутри неё пропускаются.
   */
  inline(parent: SyntaxNode, from: number, to: number): string {
    const tags = this.tagPairs(parent, from, to);
    let out = '';
    let pos = from;

    const children: SyntaxNode[] = [];
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.from >= from && child.to <= to) children.push(child);
    }

    const spans = this.spansIn(from, to);
    let spanIndex = 0;
    let childIndex = 0;

    while (pos < to) {
      // Ближайшая вики-ссылка, которая не режет детей пополам.
      let span = spans[spanIndex];
      while (span && (spanFrom(span) < pos || cuts(children, span))) {
        spanIndex += 1;
        span = spans[spanIndex];
      }
      const child = children[childIndex];
      const spanAt = span ? spanFrom(span) : Infinity;
      const childAt = child ? child.from : Infinity;

      if (spanAt === Infinity && childAt === Infinity) {
        out += this.plain(pos, to);
        pos = to;
        break;
      }

      if (spanAt <= childAt && span) {
        out += this.plain(pos, spanAt);
        out += this.wikilink(span);
        pos = span.to;
        spanIndex += 1;
        while (children[childIndex] && children[childIndex]!.from < pos) childIndex += 1;
        continue;
      }

      if (child) {
        out += this.plain(pos, child.from);
        const rendered = this.inlineNode(child, tags);
        out += rendered.html;
        pos = rendered.to;
        childIndex += 1;
        while (children[childIndex] && children[childIndex]!.from < pos) childIndex += 1;
      }
    }

    return out;
  }

  /**
   * Вики-ссылки внутри отрезка. Поиском делением пополам, а не перебором:
   * строчный вывод зовётся на каждый абзац, и заметка с тысячей ссылок
   * и тысячей абзацев перебором стоила бы миллион сравнений.
   */
  private spansIn(from: number, to: number): WikilinkSpan[] {
    let low = 0;
    let high = this.spans.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (spanFrom(this.spans[middle]!) < from) low = middle + 1;
      else high = middle;
    }

    const out: WikilinkSpan[] = [];
    for (let index = low; index < this.spans.length; index += 1) {
      const span = this.spans[index]!;
      if (spanFrom(span) >= to) break;
      if (span.to <= to) out.push(span);
    }
    return out;
  }

  /** Пары строчных тегов среди детей: `<u>` из белого списка (Р-262). */
  private tagPairs(parent: SyntaxNode, from: number, to: number): Map<number, string> {
    const placed: PlacedTag[] = [];
    for (const child of parent.getChildren('HTMLTag')) {
      if (child.from < from || child.to > to) continue;
      const tag = readTag(this.text(child.from, child.to));
      if (tag) placed.push({ from: child.from, to: child.to, tag });
    }

    const out = new Map<number, string>();
    for (const pair of pairTags(placed)) {
      out.set(pair.open.from, `<${pair.name}>`);
      out.set(pair.close.from, `</${pair.name}>`);
    }
    return out;
  }

  /** Один строчный узел. Возвращает и то, докуда он съел текст. */
  private inlineNode(node: SyntaxNode, tags: Map<number, string>): { html: string; to: number } {
    const whole = (html: string): { html: string; to: number } => ({ html, to: node.to });

    switch (node.name) {
      case 'Emphasis':
        return whole(`<em>${this.inner(node, 'EmphasisMark')}</em>`);
      case 'StrongEmphasis':
        return whole(`<strong>${this.inner(node, 'EmphasisMark')}</strong>`);
      case 'Strikethrough':
        return whole(`<del>${this.inner(node, 'StrikethroughMark')}</del>`);
      case 'Highlight':
        return whole(`<mark>${this.inner(node, 'HighlightMark')}</mark>`);
      case 'InlineCode': {
        const marks = node.getChildren('CodeMark');
        const from = marks[0] ? marks[0].to : node.from;
        const to = marks.length > 1 ? marks[marks.length - 1]!.from : node.to;
        return whole(`<code>${escapeHtml(this.text(from, to))}</code>`);
      }
      case 'Link':
        return whole(this.link(node));
      case 'Image':
        return whole(this.image(node));
      case 'Autolink': {
        const url = node.getChild('URL');
        return whole(url ? this.anchor(this.text(url.from, url.to), escapeHtml(this.text(url.from, url.to))) : '');
      }
      case 'URL': {
        // Голый адрес в тексте — GFM делает его ссылкой.
        const text = this.text(node.from, node.to);
        return whole(this.anchor(text, escapeHtml(text)));
      }
      case 'Escape':
        // `\*` — это звёздочка, а не начало курсива.
        return whole(escapeHtml(this.text(node.from + 1, node.to)));
      case 'Entity':
        // `&amp;` разбор признал сущностью — она и есть HTML.
        return whole(this.text(node.from, node.to));
      case 'HardBreak':
        return { html: '<br>\n', to: this.afterIndent(node.to) };
      case 'HTMLTag': {
        const text = this.text(node.from, node.to);
        const paired = tags.get(node.from);
        if (paired) return whole(paired);
        if (isBreak(text)) return whole('<br>');
        return whole(escapeHtml(text));
      }
      case 'QuoteMark':
        // Знак цитаты на продолжении абзаца — вместе с пробелом за ним.
        return { html: '', to: this.source.char(node.to) === ' ' ? node.to + 1 : node.to };
      case 'Comment':
      case 'ProcessingInstruction':
        return whole('');
      default:
        // Индексы `~x~`, `^x^`, `:смайлик:` и прочее, что превью
        // не рисует, — как написано.
        return whole(escapeHtml(this.text(node.from, node.to)));
    }
  }

  /** Содержимое узла без его знаков по краям. */
  private inner(node: SyntaxNode, markName: string): string {
    const marks = node.getChildren(markName);
    const from = marks[0] ? marks[0].to : node.from;
    const to = marks.length > 1 ? marks[marks.length - 1]!.from : node.to;
    return this.inline(node, from, to);
  }

  /** `[текст](адрес)`. Без адреса или с чужой схемой — просто текст. */
  private link(node: SyntaxNode): string {
    const marks = node.getChildren('LinkMark');
    const text = marks.length >= 2 ? this.inline(node, marks[0]!.to, marks[1]!.from) : '';
    const url = node.getChild('URL');
    if (!url) return text;
    return this.anchor(this.text(url.from, url.to), text);
  }

  private anchor(url: string, text: string): string {
    const href = this.options.links ? safeHref(url) : null;
    return href === null ? text : `<a href="${escapeHtml(href)}">${text}</a>`;
  }

  /** `![подпись](путь)`: локальная — из ресурсов, сетевая — подписью (Р-202). */
  private image(node: SyntaxNode): string {
    const marks = node.getChildren('LinkMark');
    const alt = marks.length >= 2 ? this.text(marks[0]!.to, marks[1]!.from) : '';
    const url = node.getChild('URL');
    const link = url ? localTarget(this.text(url.from, url.to)) : null;
    const data = link === null ? undefined : this.resources.images.get(imageKey('path', link));

    if (data !== undefined) return imageTag(data, alt);
    if (this.options.missingImage === 'source') return escapeHtml(this.text(node.from, node.to));
    return escapeHtml(alt);
  }

  /**
   * Вики-ссылка: подписью, без адреса — в отдельном файле ей вести некуда.
   * `[[цель|подпись]]` — подписью, `[[цель]]` и `[[цель#раздел]]` —
   * как написано внутри скобок, так же, как в превью. Вставка картинки —
   * картинкой; вставка не-картинки — исходником, как в превью (задача 83).
   */
  private wikilink(span: WikilinkSpan): string {
    // В таблице палку подписи экранируют — `[[цель\|подпись]]`, как
    // в Obsidian: иначе GFM разрезал бы ссылку на две ячейки.
    const inner = span.inner.replace(/\\\|/g, '|');
    const target = linkTarget(inner);
    const bar = inner.indexOf('|');
    const alias = bar >= 0 ? inner.slice(bar + 1).trim() : '';

    if (span.embed) {
      if (!embedIsImage(target)) return escapeHtml(this.text(spanFrom(span), span.to));
      const data = this.resources.images.get(imageKey('embed', target));
      if (data !== undefined) return imageTag(data, alias === '' ? target : alias);
      if (this.options.missingImage === 'source') {
        return escapeHtml(this.text(spanFrom(span), span.to));
      }
      return escapeHtml(alias === '' ? target : alias);
    }

    return escapeHtml(bar >= 0 ? alias : inner);
  }

  /**
   * Текст между узлами. Перенос строки внутри абзаца выводится переносом:
   * превью показывает строки строками, и Obsidian по умолчанию тоже, —
   * напечатанное не должно склеивать то, что на экране стоит порознь.
   * Отступ продолжения и пробелы в конце строки — не текст.
   */
  private plain(from: number, to: number): string {
    if (to <= from) return '';
    const text = this.text(from, to);
    return escapeHtml(text).replace(/[ \t]*\r?\n[ \t]*/g, '<br>\n');
  }

  /** После жёсткого переноса: отступ следующей строки — не текст. */
  private afterIndent(pos: number): number {
    let at = pos;
    while (this.source.char(at) === ' ' || this.source.char(at) === '\t') at += 1;
    return at;
  }

  private text(from: number, to: number): string {
    return this.source.slice(from, to);
  }
}

/** Текст блока кода: с оградой или отступом. */
export function blockBody(node: SyntaxNode, source: Source): string {
  return node.name === 'FencedCode' ? fencedBody(node, source) : indentedBody(node, source);
}

/** Что написано в ограде после кавычек — `rust`, `c++`. `null` — ничего. */
export function blockInfo(node: SyntaxNode, source: Source): string | null {
  const info = node.getChild('CodeInfo');
  const text = info ? source.slice(info.from, info.to).trim() : '';
  return text === '' ? null : text;
}

/** Режет ли вики-ссылка какого-то ребёнка пополам. */
function cuts(children: readonly SyntaxNode[], span: WikilinkSpan): boolean {
  const from = spanFrom(span);
  return children.some(
    (child) =>
      (child.from < from && child.to > from) || (child.from < span.to && child.to > span.to),
  );
}

function imageTag(data: string, alt: string): string {
  return `<img src="${escapeHtml(data)}" alt="${escapeHtml(alt)}">`;
}

function alignAttr(align: Align | undefined): string {
  return align ? ` style="text-align: ${align}"` : '';
}

/**
 * Цвет коллаута в атрибут `style`. Из файла человека приходит роль темы
 * (уже `var(--zn-…)`) или `#rrggbb`; всё прочее — акцент: строка из чужого
 * файла не должна дописывать в атрибут что-то своё.
 */
function calloutColor(color: string): string {
  if (/^var\(--zn-[a-z0-9-]+\)$/.test(color)) return color;
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  return 'var(--zn-color-accent)';
}
