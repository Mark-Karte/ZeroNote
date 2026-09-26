import { styleTags, tags } from '@lezer/highlight';
import type { SyntaxNode } from '@lezer/common';
import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown';
import type { Text } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';

/**
 * Формулы LaTeX в заметках (задача 115): разбор и показ.
 *
 * **Синтаксис Obsidian**: `$…$` — в строке, `$$…$$` — блоком (Р-276).
 * `\(…\)` и `\[…\]` Obsidian не разбирает, мы тоже.
 *
 * **Разбор — узлами дерева, а не своим поиском по тексту** — тот же приём,
 * что у `==выделения==` (Р-154). Формулу видят все, кто смотрит в дерево:
 * превью, вывод HTML, проверка «здесь нет ссылок» (Р-275).
 *
 * **Доллар — не всегда формула.** «Стоило $5, стало $10» формулой быть
 * не должно. Правило как у Pandoc: открывающий `$` не стоит перед пробелом,
 * закрывающий не стоит после пробела и перед цифрой; `\$` — просто знак
 * (это делает разбор экранирования markdown ещё до нас).
 *
 * **Рисует Temml** (решение владельца): MathML, который рисует сам движок
 * окна. Модуль грузится при первой формуле на экране (`math-render.ts`),
 * до того формула видна исходником.
 */

const DOLLAR = 36;
const BACKSLASH = 92;

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/**
 * Где закрывается строчная формула `$…$`, открытая в `open`, или `-1`.
 *
 * Чистая функция над знаками — ради теста правила доллара без разбора.
 * `char(i)` отдаёт код знака или `-1` за краем.
 */
export function closeInline(char: (at: number) => number, open: number, end: number): number {
  // Открывает не всякий доллар: перед пробелом это цена, а `$$` —
  // выключная формула, у неё своё правило.
  const first = char(open + 1);
  if (first < 0 || isSpace(first) || first === DOLLAR) return -1;
  if (char(open - 1) === DOLLAR) return -1;

  for (let at = open + 1; at < end; at += 1) {
    const code = char(at);
    // `\$` внутри формулы — знак доллара в TeX, а не конец формулы.
    if (code === BACKSLASH) {
      at += 1;
      continue;
    }
    if (code !== DOLLAR) continue;
    if (isSpace(char(at - 1))) continue;
    if (isDigit(char(at + 1))) continue;
    return at;
  }
  return -1;
}

/** Где закрывается `$$…$$`, открытая в `open`, или `-1`. */
export function closeDisplay(char: (at: number) => number, open: number, end: number): number {
  for (let at = open + 2; at + 1 < end; at += 1) {
    const code = char(at);
    if (code === BACKSLASH) {
      at += 1;
      continue;
    }
    if (code === DOLLAR && char(at + 1) === DOLLAR) return at;
  }
  return -1;
}

/**
 * Что за строка для блочной формулы.
 *
 * * `'none'` — не начинает блок;
 * * `'whole'` — формула целиком на строке: `$$x$$`;
 * * `'open'` — открывает многострочную: `$$` и, может быть, начало TeX.
 *
 * Строка, где `$$…$$` стоит не в конце (`$$x$$ и текст`), блоком
 * не считается — это выключная формула посреди абзаца, её разберёт
 * строчный разбор.
 */
function blockShape(line: Line): { kind: 'none' } | { kind: 'whole'; close: number } | { kind: 'open' } {
  if (line.indent - line.baseIndent >= 4) return { kind: 'none' };
  const text = line.text;
  const at = line.pos;
  if (text.charCodeAt(at) !== DOLLAR || text.charCodeAt(at + 1) !== DOLLAR) return { kind: 'none' };

  const char = (i: number): number => (i < text.length ? text.charCodeAt(i) : -1);
  const close = closeDisplay(char, at, text.length);
  if (close < 0) return { kind: 'open' };
  if (text.slice(close + 2).trim() !== '') return { kind: 'none' };
  return { kind: 'whole', close };
}

/**
 * Продолжает ли строка цитату или пункт списка, в котором стоит формула.
 *
 * Поле `depth` у строки внутреннее (`@internal` в `@lezer/markdown`),
 * но им пользуется их же блок кода — ровно для этого вопроса. Публичного
 * пути нет: у пункта списка знаков продолжения не бывает, одна глубина
 * отступа. Исчезнет поле при обновлении — формула в коллауте потянется
 * за конец цитаты, и это поймает тест «формула в коллауте».
 */
function continues(cx: BlockContext, line: Line): boolean {
  const depth = (line as unknown as { depth?: number }).depth;
  return depth === undefined || depth >= cx.depth;
}

/** Конец строки без пробелов в хвосте: там ищется закрывающий `$$`. */
function trimmedEnd(text: string): number {
  let end = text.length;
  while (end > 0 && isSpace(text.charCodeAt(end - 1))) end -= 1;
  return end;
}

/**
 * Блочная формула. Устроена как блок кода в `@lezer/markdown`: строки
 * берутся, пока не встретится закрывающий `$$` в конце строки, и внутри
 * цитаты или пункта списка — пока они продолжаются (`line.depth`).
 *
 * **Незакрытая тянется до конца** — документа или цитаты, в которой
 * стоит, — как незакрытый блок кода. Причина та же, что у frontmatter
 * (Р-274): иначе дописанный ниже `$$` не был бы замечен разбором, который
 * перечитывает только то, что рядом с правкой.
 */
function parseBlock(cx: BlockContext, line: Line): boolean {
  const shape = blockShape(line);
  if (shape.kind === 'none') return false;

  const from = cx.lineStart + line.pos;
  const marks = [cx.elt('BlockMathMark', from, from + 2)];

  if (shape.kind === 'whole') {
    const close = cx.lineStart + shape.close;
    marks.push(cx.elt('BlockMathMark', close, close + 2));
    cx.nextLine();
    cx.addElement(cx.elt('BlockMath', from, close + 2, marks));
    return true;
  }

  while (cx.nextLine() && continues(cx, line)) {
    // Знаки цитаты на продолжении — дети формулы, как у блока кода:
    // иначе вывод и превью приняли бы `> ` за часть TeX.
    marks.push(...line.markers);
    const end = trimmedEnd(line.text);
    if (end - line.pos >= 2 && line.text.charCodeAt(end - 1) === DOLLAR && line.text.charCodeAt(end - 2) === DOLLAR) {
      const close = cx.lineStart + end - 2;
      marks.push(cx.elt('BlockMathMark', close, close + 2));
      cx.nextLine();
      break;
    }
  }

  cx.addElement(cx.elt('BlockMath', from, cx.prevLineEnd(), marks));
  return true;
}

/** Расширение разбора markdown: `InlineMath` и `BlockMath` со знаками. */
export const mathSyntax: MarkdownConfig = {
  defineNodes: [
    'InlineMath',
    'InlineMathMark',
    { name: 'BlockMath', block: true },
    'BlockMathMark',
  ],
  parseInline: [
    {
      name: 'InlineMath',
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1;
        const char = (at: number): number => (at >= cx.offset && at < cx.end ? cx.char(at) : -1);

        // `$$…$$` посреди абзаца — выключная формула в строке.
        if (char(pos + 1) === DOLLAR) {
          const close = closeDisplay(char, pos, cx.end);
          if (close < 0 || close === pos + 2) return -1;
          return cx.addElement(
            cx.elt('InlineMath', pos, close + 2, [
              cx.elt('InlineMathMark', pos, pos + 2),
              cx.elt('InlineMathMark', close, close + 2),
            ]),
          );
        }

        const close = closeInline(char, pos, cx.end);
        if (close < 0) return -1;
        return cx.addElement(
          cx.elt('InlineMath', pos, close + 1, [
            cx.elt('InlineMathMark', pos, pos + 1),
            cx.elt('InlineMathMark', close, close + 1),
          ]),
        );
      },
    },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'FencedCode',
      parse: parseBlock,
      // `$$` прерывает абзац, как ограда блока кода: формулу пишут сразу
      // под строкой текста, без пустой строки между ними.
      endLeaf: (_cx, line) => blockShape(line).kind !== 'none',
    },
  ],
  props: [
    styleTags({
      // Исходник формулы — цветом строки, знаки `$` — приглушённо: в исходном
      // режиме формула видна, но не спорит с текстом.
      'InlineMath/... BlockMath/...': tags.special(tags.string),
      'InlineMathMark BlockMathMark': tags.processingInstruction,
    }),
  ],
};

/** Формула в дереве: её TeX и вид. */
export interface MathSource {
  tex: string;
  /** Выключная (`$$…$$`) — рисуется отдельным блоком по центру. */
  display: boolean;
}

/**
 * TeX формулы: текст узла без его детей — знаков `$` и знаков цитаты
 * на продолжениях строк. Лишний пробел или перенос TeX не смущает.
 */
export function mathSource(read: (from: number, to: number) => string, node: SyntaxNode): MathSource {
  let tex = '';
  let at = node.from;
  let display = node.name === 'BlockMath';
  for (let child = node.firstChild; child; child = child.nextSibling) {
    tex += read(at, child.from);
    at = child.to;
    if (child.name === 'InlineMathMark' && child.to - child.from === 2) display = true;
  }
  tex += read(at, node.to);
  return { tex: tex.trim(), display };
}

/**
 * Как рисовать блочную формулу: целыми строками (поле блочного превью)
 * или внутри строки (плагин превью).
 *
 * Целыми строками — когда перед формулой только отступ, или когда она
 * на нескольких строках: плагину замена через перенос запрещена.
 * Внутри строки — однострочная в пункте списка или в цитате: замена
 * целой строки съела бы знак пункта, а в коллауте — оформление карточки,
 * которое держится на самой строке.
 */
export function drawsAsBlock(doc: Text, from: number, to: number): boolean {
  const line = doc.lineAt(from);
  if (to > line.to) return true;
  return /^\s*$/.test(doc.sliceString(line.from, from));
}

// ------------------------------------------------------------ рисование

type Rendered = { html: string } | { error: string };

let engine: typeof import('./math-render') | null = null;
let loading: Promise<void> | null = null;

/**
 * Загрузить Temml. Один раз на окно; ошибка загрузки — не повод
 * пробовать на каждой формуле заново.
 */
export function loadMath(): Promise<void> {
  loading ??= import('./math-render').then((module) => {
    engine = module;
  });
  return loading;
}

/**
 * Готовая разметка по тексту формулы. Формулы в заметке меняются редко,
 * а украшения пересобираются на каждое движение курсора: без памяти
 * каждая перерисовка разбирала бы TeX заново. Предел — чтобы память
 * не росла вместе с историей правок.
 */
const rendered = new Map<string, Rendered>();
const RENDERED_LIMIT = 500;

/** Нарисовать формулу. `null` — Temml ещё не загружен. */
export function renderMath(tex: string, display: boolean): Rendered | null {
  if (engine === null) return null;
  const key = `${display ? 'D' : 'I'}${tex}`;
  const known = rendered.get(key);
  if (known) return known;

  let result: Rendered;
  try {
    result = { html: engine.toMathML(tex, display) };
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  if (rendered.size >= RENDERED_LIMIT) rendered.clear();
  rendered.set(key, result);
  return result;
}

/**
 * Формула в превью: MathML на месте исходника (Р-160 — показ, а не текст).
 *
 * Пока Temml грузится, виджет показывает исходник и дорисовывается сам,
 * когда модуль приедет. Неразборчивая формула остаётся исходником
 * с пометкой ошибки — превью не сочиняет (Р-178).
 */
export class MathWidget extends WidgetType {
  constructor(
    /** Исходник целиком, со знаками: его показывает виджет до Temml и при ошибке. */
    readonly source: string,
    readonly math: MathSource,
    /**
     * Виджет стоит на месте целых строк (поле блочного превью), а не
     * внутри строки. Выключная формула бывает и в строке — `$$x$$`
     * посреди абзаца или в пункте списка.
     */
    readonly block: boolean,
  ) {
    super();
  }

  override eq(other: MathWidget): boolean {
    return (
      other.source === this.source &&
      other.math.display === this.math.display &&
      other.block === this.block
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement(this.block ? 'div' : 'span');
    box.className = this.block ? 'zn-math zn-math-block' : 'zn-math';

    if (!this.fill(box)) {
      box.textContent = this.source;
      void loadMath().then(() => {
        this.fill(box);
        // Высота строки меняется: формула выше строки текста.
        view.requestMeasure();
      });
    }
    return box;
  }

  /** Нарисовать, если Temml готов. `false` — ещё не загружен. */
  private fill(box: HTMLElement): boolean {
    const result = renderMath(this.math.tex, this.math.display);
    if (result === null) return false;
    if ('html' in result) {
      // MathML из Temml, а не из заметки: TeX разобран, `\href` и прочее
      // исполняемое выключено (`trust: false`).
      box.innerHTML = result.html;
      box.classList.remove('zn-math-error');
      box.removeAttribute('title');
    } else {
      box.textContent = this.source;
      box.classList.add('zn-math-error');
      box.title = result.error;
    }
    return true;
  }

  /** Щелчок по формуле ставит курсор — и строка возвращается исходником (Р-158). */
  override ignoreEvent(): boolean {
    return false;
  }
}
