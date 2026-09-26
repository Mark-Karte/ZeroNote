import { markdownToHtml, codeToHtml } from '../html/convert';
import { isMarkdownTab } from '../html/tab';
import { previewEmbed, previewImage } from '../ipc/files';
import { mountDocument } from '../print/print';
import { calloutLookup } from '../state/callouts.svelte';
import { languageOf, type Tab } from '../state/tabs.svelte';

/**
 * Копировать с оформлением (задача 112): в буфер уходят два формата —
 * HTML для почты, Word и Teams и исходный текст для всего остального.
 *
 * **Стиль — в самих элементах.** Почтовые программы и Word выбрасывают
 * `<style>`, поэтому документ ставится в окно тем же путём, что у печати
 * (светлая тема, стиль документа), и вычисленный браузером стиль каждого
 * элемента вписывается в его атрибут. Второго набора правил оформления нет:
 * источник один — `document.css`.
 *
 * **Шрифт текста — один, на обёртке.** Своё у элементов — только то, что
 * отличает их от текста: размер и вес заголовков, моноширинный шрифт,
 * подложка и раскраска кода, рамки таблиц, цвет ссылок и коллаутов. Шрифт
 * самого текста задан обёрткой — шрифт интерфейса с системными запасными:
 * без него Word читает HTML шрифтом Times New Roman, а не своим (найдено
 * вставкой в настоящий Word).
 *
 * **Word понимает не всё, что понимает браузер**, и это тоже найдено
 * вставкой: `<del>` он считает удалённым правкой текстом и выбрасывает,
 * полупрозрачных цветов не знает, рамку у `<div>` не рисует. Отсюда
 * зачёркнутое — `<span>`, цвета — непрозрачными над белым листом,
 * коллаут — таблицей в одну ячейку.
 *
 * Модуль грузится по команде, как печать и экспорт.
 */

type Style = Readonly<Record<string, string>>;

/** Наследуемое: пишется, только когда отличается от родителя. */
const INHERITED = [
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'text-align',
  'list-style-type',
  // Наследуется: иначе `pre-wrap` повторялся бы на каждом кусочке кода.
  'white-space',
] as const;

/** Своё у элемента: пишется, только когда не пустое. */
const OWN: ReadonlyArray<readonly [string, string]> = [
  ['background-color', 'rgba(0, 0, 0, 0)'],
  ['text-decoration-line', 'none'],
  ['border-radius', '0px'],
  ['padding-top', '0px'],
  ['padding-right', '0px'],
  ['padding-bottom', '0px'],
  ['padding-left', '0px'],
  ['vertical-align', 'baseline'],
];

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Какие свойства вычисленного стиля нужны: чтобы не читать все сотни. */
export const WANTED: readonly string[] = [
  ...INHERITED,
  ...OWN.map(([name]) => name),
  ...SIDES.flatMap((side) => [
    `border-${side}-style`,
    `border-${side}-width`,
    `border-${side}-color`,
  ]),
];

/**
 * Полупрозрачный цвет — непрозрачным, как он лёг бы на белый лист.
 *
 * Word `rgba()` не понимает и молча выбрасывает — подложки кода, выделения
 * и коллаутов пропадали. Лист белый (бумага светлая, Р-268), поэтому
 * смешивается с белым. Прочие значения — как есть.
 */
export function opaque(value: string): string {
  const match = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value);
  if (!match) return value;
  const alpha = Number(match[4]);
  const mix = (channel: string): number => Math.round(Number(channel) * alpha + 255 * (1 - alpha));
  return `rgb(${mix(match[1]!)}, ${mix(match[2]!)}, ${mix(match[3]!)})`;
}

/**
 * Вес шрифта словом. Word знает только «жирный» и «обычный»: наш вес
 * заголовка 600 он читал как обычный, и заголовки теряли жирность.
 */
export function weight(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return number >= 600 ? 'bold' : 'normal';
}

/**
 * Стиль элемента для вставки — строкой атрибута `style`.
 *
 * Чистая функция над уже вычисленными значениями: браузер считает каскад,
 * здесь решается только, что из него писать. Проверяется тестом без окна.
 */
export function styleFor(own: Style, parent: Style): string {
  const out: string[] = [];

  for (const name of INHERITED) {
    const value = own[name];
    if (value === undefined || value === parent[name]) continue;
    out.push(`${name}: ${name === 'font-weight' ? weight(value) : opaque(value)}`);
  }

  for (const [name, empty] of OWN) {
    const value = own[name];
    if (value === undefined || value === empty) continue;
    // Word понимает `text-decoration`, а не его части.
    out.push(`${name === 'text-decoration-line' ? 'text-decoration' : name}: ${opaque(value)}`);
  }

  for (const side of SIDES) {
    const style = own[`border-${side}-style`];
    const width = own[`border-${side}-width`];
    if (!style || style === 'none' || width === '0px') continue;
    const color = opaque(own[`border-${side}-color`] ?? '');
    out.push(`border-${side}: ${width} ${style} ${color}`.trim());
  }

  return out.join('; ');
}

/** Шрифт, размер и цвет текста — для обёртки всего, что вставляется. */
export function textStyle(root: Style): string {
  return ['font-family', 'font-size', 'color']
    .filter((name) => root[name])
    .map((name) => `${name}: ${opaque(root[name]!)}`)
    .join('; ');
}

/** Нужные свойства вычисленного стиля — обычным словарём. */
function computed(element: Element): Style {
  const style = getComputedStyle(element);
  const out: Record<string, string> = {};
  for (const name of WANTED) out[name] = style.getPropertyValue(name);
  return out;
}

/**
 * Вписать стиль в элементы и переделать то, чего получатель не поймёт.
 *
 * Значки — рисунки SVG, а почта и Word их не вставляют: значок коллаута
 * уходит (цвет и заголовок остаются), переключатель задачи становится
 * знаком ☐ или ☑. Строка кода у нас — блок, а Word блоком её не считает
 * и склеил бы весь код в одну строку, поэтому строки разделяются `<br>`.
 */
function prepareForPaste(root: HTMLElement): string {
  // Сначала то, что узнаётся по классам, — пока классы на месте.
  for (const icon of Array.from(root.querySelectorAll('.zn-callout-icon'))) icon.remove();
  const boxes = Array.from(root.querySelectorAll<HTMLElement>('.zn-callout'));
  for (const box of Array.from(root.querySelectorAll('.zn-task'))) {
    const done = box.closest('.zn-task-item-done') !== null;
    box.replaceWith(document.createTextNode(done ? '☑' : '☐'));
  }
  for (const code of Array.from(root.querySelectorAll('pre > code'))) {
    const lines = Array.from(code.querySelectorAll(':scope > .zn-line'));
    lines.forEach((line, index) => {
      // Пустая строка держала высоту своим `<br>` — он и станет переводом.
      const parts = Array.from(line.childNodes).filter((node) => node.nodeName !== 'BR');
      if (index < lines.length - 1) parts.push(document.createElement('br'));
      line.replaceWith(...parts);
    });
  }

  // Word съедает обычный пробел сразу за формулой — «V_REFберётся»
  // (найдено вставкой, задача 116), в любой разметке вокруг неё.
  // Неразрывный он оставляет, и формула заодно не отрывается от слова.
  // Знак — кодом: записанный в исходник, он доехал бы невидимым.
  const nbsp = String.fromCharCode(0xa0);
  for (const box of Array.from(root.querySelectorAll('.zn-math'))) {
    const next = box.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE && next.textContent?.startsWith(' ')) {
      next.textContent = nbsp + next.textContent.slice(1);
    }
  }

  // Формулы — MathML как есть (задача 116). Вычисленный стиль каждого
  // `<mi>` и `<mfrac>` получателю не нужен: формулу раскладывает он сам.
  // Пространство имён в разметке HTML не пишется — `innerHTML` его
  // опускает, — а без него MathML для получателя просто незнакомые теги.
  for (const math of Array.from(root.querySelectorAll('math'))) {
    math.setAttribute('xmlns', 'http://www.w3.org/1998/Math/MathML');
  }

  // Потом стиль: вычисляется весь разом, до первой записи, — иначе
  // вписанный стиль родителя менял бы то, с чем сравнивают детей.
  const elements = Array.from(root.querySelectorAll('*')).filter(
    (element) => element.closest('math') === null,
  );
  const styles = new Map<Element, Style>([[root, computed(root)]]);
  for (const element of elements) styles.set(element, computed(element));

  for (const element of elements) {
    const parent = styles.get(element.parentElement ?? root) ?? styles.get(root)!;
    const style = styleFor(styles.get(element)!, parent);
    if (style === '') element.removeAttribute('style');
    else element.setAttribute('style', style);
    element.removeAttribute('class');
    element.removeAttribute('data-lang');
  }

  // Последним — то, что Word понимает иначе браузера. `<del>` для него —
  // удалённый правкой текст, и он его выбрасывает; у `<mark>` не рисует
  // подложку. Обоим нужен `<span>` с тем же стилем.
  for (const odd of Array.from(root.querySelectorAll('del, mark'))) {
    const span = document.createElement('span');
    const style = odd.getAttribute('style');
    if (style) span.setAttribute('style', style);
    span.append(...Array.from(odd.childNodes));
    odd.replaceWith(span);
  }

  // Заголовки остаются `<h1>`…`<h6>`: Word делает из них заголовки своего
  // документа — их видят навигация и оглавление — и рисует **своим** стилем
  // заголовка. Жирность при этом решает он, и в современном Office его
  // заголовок тонкий; ни `font-weight`, ни `<b>` этого не меняют — проверено
  // вставкой. Ломать структуру ради жирности не стоит.

  // Ячейка таблицы в Word шрифт обёртки не наследует — вставка выходила
  // Times New Roman. Ячейке, у которой своего шрифта нет, — шрифт текста.
  const text = textStyle(styles.get(root)!);
  for (const cell of Array.from(root.querySelectorAll('td, th'))) {
    const own = cell.getAttribute('style') ?? '';
    if (own.includes('font-family')) continue;
    cell.setAttribute('style', own === '' ? text : `${text}; ${own}`);
  }
  for (const box of boxes) {
    // Рамку и заливку у `<div>` Word не рисует, у ячейки таблицы — да.
    const table = document.createElement('table');
    table.setAttribute('style', 'border-collapse: collapse; width: 100%');
    const row = table.insertRow();
    const cell = row.insertCell();
    cell.setAttribute('style', `${text}; ${box.getAttribute('style') ?? ''}`);
    cell.append(...Array.from(box.childNodes));
    box.replaceWith(table);
  }

  return text;
}

/** Что копировать: выделения, а если их нет — весь текст. */
export function pickText(doc: string, ranges: ReadonlyArray<{ from: number; to: number }>): {
  text: string;
  whole: boolean;
} {
  const chosen = ranges.filter((range) => range.to > range.from);
  if (chosen.length === 0) return { text: doc, whole: true };
  return { text: chosen.map((range) => doc.slice(range.from, range.to)).join('\n'), whole: false };
}

/**
 * Скопировать вкладку или выделение в ней. Возвращает, что скопировано
 * и что не вошло.
 */
export async function copyRich(
  tab: Tab,
  ranges: ReadonlyArray<{ from: number; to: number }>,
): Promise<{ whole: boolean; problems: string[] }> {
  const doc = tab.editor?.state.doc.toString() ?? '';
  const { text, whole } = pickText(doc, ranges);
  // Выделение с первой строки файла начинается там же, где frontmatter,
  // и служебные поля в нём пропускаются, как при печати. Выделение
  // из середины — кусок, и `---` в его начале — черта (задача 114).
  const fragment = !whole && !ranges.some((range) => range.to > range.from && range.from === 0);

  const built = isMarkdownTab(tab)
    ? await markdownToHtml(
        text,
        {
          callouts: calloutLookup(),
          sourcePath: tab.meta.path,
          loadImage: previewImage,
          loadEmbed: previewEmbed,
        },
        { fragment },
      )
    : await codeToHtml(text, languageOf(tab)?.id ?? null);

  const mounted = await mountDocument(built.html, true);
  let html: string;
  try {
    const wrapper = prepareForPaste(mounted.article);
    html = `<div style="${wrapper.replace(/"/g, '&quot;')}">${mounted.article.innerHTML}</div>`;
  } finally {
    mounted.unmount();
  }

  // Два формата одним вызовом: HTML получат те, кто его понимает,
  // исходный текст — все остальные, включая сам ZeroNote.
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    }),
  ]);

  return { whole, problems: [...mounted.problems, ...built.problems] };
}
