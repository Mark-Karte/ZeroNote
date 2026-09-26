import type { EditorState, Range } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, WidgetType, type EditorView } from '@codemirror/view';

import { fencedBody } from '../html/code';
import { Source } from '../html/source';
import type { DiagramTheme } from './diagram-render';

/**
 * Схемы mermaid в превью (задача 117).
 *
 * Блок ` ```mermaid ` показывается схемой, когда курсора в нём нет (Р-158,
 * единица раскрытия — блок, Р-184). Рисует mermaid — он грузится при первой
 * схеме на экране (`diagram-render.ts`), до того и пока идёт отрисовка
 * блок виден исходником.
 *
 * **Не на пути ввода** (инвариант 6): пока курсор в блоке, схемы нет —
 * перерисовка случается, когда курсор ушёл, а не на каждую букву. Готовое
 * хранится по тексту схемы и теме: вернулся к схеме, не трогая её, —
 * она берётся из памяти.
 */

/** Язык блока, который рисуется схемой. */
export const DIAGRAM_LANGUAGE = 'mermaid';

/**
 * Предел размера схемы, в знаках.
 *
 * Разбор и раскладка mermaid идут в потоке окна целиком, и всё это время
 * окно не отвечает. Замер задачи 117 (`bench/diagram`): блок-схема
 * в 30 узлов — 0,1 с, в 150 узлов (6,4 тысячи знаков) — 0,55 с,
 * и раскладка растёт быстрее размера. На пределе окно замирает около
 * секунды — заметно, но ещё не похоже на зависание; больше — отказ
 * словами, как у вывода HTML (Р-265). Схема такого размера на экране
 * всё равно не читается.
 */
export const DIAGRAM_LIMIT = 10_000;

export type Drawn = { svg: string } | { error: string };

let engine: Promise<typeof import('./diagram-render')> | null = null;

/** Загрузить mermaid. Один раз на окно. */
function loadEngine(): Promise<typeof import('./diagram-render')> {
  engine ??= import('./diagram-render');
  return engine;
}

/**
 * Поколение темы. Растёт при смене оформления: виджет помнит поколение,
 * при котором создан, и после смены темы не считается равным новому —
 * CodeMirror пересоздаёт его, и схема рисуется новыми цветами.
 */
let generation = 0;

/** Тема сменилась: следующие схемы рисуются заново её цветами. */
export function diagramThemeChanged(): void {
  generation += 1;
}

/** Нарисованное — по теме и тексту. Предел — чтобы память не росла с правками. */
const drawn = new Map<string, Promise<Drawn>>();
const DRAWN_LIMIT = 100;

/** Тёмен ли цвет `rgb(…)`: по нему mermaid выбирает, светлить или темнить. */
function isDark(color: string): boolean {
  const [r = 255, g = 255, b = 255] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/**
 * Цвета схемы — из токенов, действующих внутри `scope`.
 *
 * Значения — вычисленными: `rgb(…)`, а не `var(--zn-…)`. mermaid смешивает
 * цвета сам (темнее, светлее — для обводок и подписей), и переменная CSS
 * ему непонятна: нужен готовый цвет. Вычисляет браузер — через пробник
 * внутри `scope`, где токены те, что нужны: окна или бумаги.
 */
function themeIn(scope: HTMLElement): DiagramTheme {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  scope.append(probe);
  const tokenColor = (name: string): string => {
    probe.style.color = `var(--zn-${name})`;
    return getComputedStyle(probe).color;
  };
  const token = (name: string): string =>
    getComputedStyle(probe).getPropertyValue(`--zn-${name}`).trim();

  try {
    return themeFrom(tokenColor, token);
  } finally {
    probe.remove();
  }
}

/** Цвета схемы в окне — токены текущей темы. */
function currentTheme(): DiagramTheme {
  return themeIn(document.body);
}

/**
 * Цвета схемы на бумаге (задача 118) — токены светлой темы пары, те же,
 * что печать ставит на документ (`print_appearance`), а не окна: схема
 * в тёмных цветах на белом листе читалась бы как пятно.
 *
 * Токены ставятся на скрытый элемент, и браузер вычисляет их там — так же,
 * как на документе при печати: значение одного токена бывает ссылкой
 * на другой.
 */
export function paperTheme(tokens: Readonly<Record<string, string>>): DiagramTheme {
  const scope = document.createElement('div');
  scope.style.display = 'none';
  for (const [name, value] of Object.entries(tokens)) scope.style.setProperty(`--zn-${name}`, value);
  document.body.append(scope);
  try {
    return themeIn(scope);
  } finally {
    scope.remove();
  }
}

/** Цвета схемы по ролям — одно правило для окна и бумаги. */
function themeFrom(
  tokenColor: (name: string) => string,
  token: (name: string) => string,
): DiagramTheme {
  const background = tokenColor('color-bg-raised');
  return {
    dark: isDark(background),
    fontFamily: token('font-family-ui'),
    fontSize: token('font-size-editor'),
    background,
    // Узел — утопленная подложка, как у блока кода: в светлой теме
    // темнее листа, в тёмной светлее — порядок ролей тот же (Р-083).
    node: tokenColor('color-bg-canvas'),
    nodeBorder: tokenColor('color-accent'),
    text: tokenColor('color-fg-default'),
    line: tokenColor('color-fg-muted'),
    secondary: tokenColor('color-bg-hover'),
    tertiary: tokenColor('color-bg-surface'),
    cluster: tokenColor('color-bg-surface'),
    clusterBorder: tokenColor('color-border-default'),
    note: tokenColor('color-bg-selected'),
  };
}

/** Сколько схем поставлено в окно — для их имён. */
let copies = 0;

/**
 * SVG схемы с именами, которых больше нет в окне.
 *
 * mermaid называет всё внутри схемы от её имени — `zn-diagram-7`,
 * `zn-diagram-7_flowchart-v2-pointEnd` — и ссылается на эти имена:
 * стрелки (`marker-end="url(#…)"`), тени (`filter="url(#…)"`), стиль
 * (`#zn-diagram-7 …`). Готовое берётся из памяти по тексту и теме, и одна
 * строка встаёт в окно дважды — на экран и на бумагу, когда тема окна
 * совпадает с темой бумаги. Ссылка находит первый элемент с этим именем,
 * а он на экране, который при печати скрыт: скрытый маркер не рисуется,
 * элемент со ссылкой на нерисуемый фильтр пропадает целиком. На бумаге
 * у схем не было стрелок и рамок — найдено приёмкой этапа 17 на выпускной
 * сборке со светлой темой.
 *
 * Все имена внутри схемы начинаются с её собственного, поэтому хватает
 * заменить его.
 */
export function withUniqueIds(svg: string): string {
  const id = /^<svg[^>]*?\sid="([^"]+)"/.exec(svg)?.[1];
  if (id === undefined) return svg;
  copies += 1;
  return svg.split(id).join(`${id}-${copies}`);
}

/** Нарисовать схему или взять готовую. Ошибка разбора — текстом. */
export function drawDiagram(source: string, theme: DiagramTheme): Promise<Drawn> {
  if (source.length > DIAGRAM_LIMIT) {
    return Promise.resolve({
      error: `Схема не рисуется: она длиннее ${DIAGRAM_LIMIT.toLocaleString('ru-RU')} знаков, и окно рисовало бы её секундами.`,
    });
  }

  const key = `${JSON.stringify(theme)}\n${source}`;
  const known = drawn.get(key);
  if (known) return known;

  const result = loadEngine()
    .then((module) => module.renderDiagram(source, theme))
    .then(
      (svg): Drawn => ({ svg }),
      (error: unknown): Drawn => ({
        error: `Схема не разобрана: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  if (drawn.size >= DRAWN_LIMIT) drawn.clear();
  drawn.set(key, result);
  return result;
}

/**
 * Схема в превью: SVG на месте строк блока.
 *
 * Пока mermaid грузится и рисует, виджет показывает исходник; ошибку
 * разбора — словами под исходником, а не пустым местом (Р-178).
 */
export class DiagramWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly generation: number,
  ) {
    super();
  }

  override eq(other: DiagramWidget): boolean {
    return other.source === this.source && other.generation === this.generation;
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div');
    box.className = 'zn-diagram zn-diagram-pending';
    const code = document.createElement('pre');
    code.className = 'zn-diagram-source';
    code.textContent = this.source;
    box.append(code);

    void drawDiagram(this.source, currentTheme()).then((result) => {
      box.classList.remove('zn-diagram-pending');
      if ('svg' in result) {
        // SVG из mermaid в режиме `strict`: подписи вычищены DOMPurify,
        // обработчиков нет, а скрипт в окне не исполнится и так (Р-200).
        box.innerHTML = withUniqueIds(result.svg);
      } else {
        const message = document.createElement('div');
        message.className = 'zn-diagram-error';
        message.textContent = result.error;
        box.append(message);
      }
      // Высота блока сменилась: схема не той высоты, что исходник.
      view.requestMeasure();
    });
    return box;
  }

  /** Щелчок по схеме ставит курсор — и блок возвращается исходником (Р-158). */
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Схема ли блок — по тому, что написано после кавычек, первым словом.
 * Одно правило на превью и вывод HTML (задача 118): иначе блок был бы
 * схемой на экране и кодом на бумаге.
 */
export function isDiagram(info: string | null): boolean {
  return (info ?? '').trim().split(/\s+/)[0]!.toLowerCase() === DIAGRAM_LANGUAGE;
}

/** Что написано в ограде блока после кавычек. */
function blockInfo(state: EditorState, node: SyntaxNode): string | null {
  const info = node.getChild('CodeInfo');
  return info ? state.doc.sliceString(info.from, info.to) : null;
}

/**
 * Схема на месте блока ` ```mermaid `, или `null`, если блок остаётся
 * исходником: не схема, курсор в блоке, или блок стоит не с начала строки
 * (в пункте списка замена строк съела бы знак пункта).
 *
 * `touched` передаётся снаружи: он живёт в `live-preview.ts`, а тот
 * этот модуль не знает — круга импортов не будет.
 */
export function diagramBlock(
  state: EditorState,
  node: SyntaxNode,
  touched: (line: number) => boolean,
): Range<Decoration> | null {
  if (!isDiagram(blockInfo(state, node))) return null;

  const { doc } = state;
  const first = doc.lineAt(node.from);
  if (!/^[\s>]*$/.test(doc.sliceString(first.from, node.from))) return null;
  const last = doc.lineAt(Math.min(Math.max(node.from, node.to - 1), doc.length));
  for (let number = first.number; number <= last.number; number += 1) {
    if (touched(number)) return null;
  }

  // С начала строки, а не с ограды: отступ ограды внутри коллаута считается
  // от знака цитаты — так же, как у вывода HTML (задача 118).
  const source = fencedBody(node, new Source(doc.sliceString(first.from, node.to), first.from));
  if (source.trim() === '') return null;

  return Decoration.replace({
    widget: new DiagramWidget(source, generation),
    block: true,
  }).range(first.from, last.to);
}
