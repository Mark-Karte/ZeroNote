import documentCss from '../html/document.css?inline';
import printCss from './print.css?inline';

import { lineNumbersOn } from '../editor/line-numbers';
import { codeToHtml, markdownToHtml, type Converted } from '../html/convert';
import { escapeHtml } from '../html/escape';
import { printAppearance } from '../ipc/appearance';
import { imageSource, previewEmbed, previewImage } from '../ipc/files';
import { calloutLookup } from '../state/callouts.svelte';
import { lineNumbersSetting } from '../state/settings.svelte';
import { languageOf, type Tab } from '../state/tabs.svelte';

/**
 * Печать (задача 109).
 *
 * Модуль грузится по требованию — командой, а не при запуске: вместе
 * с ним приезжает весь вывод HTML, и платить за него каждым стартом ради
 * команды, которую жмут раз в неделю, незачем.
 *
 * Путь один: документ собирает вывод HTML (задача 108), печатает
 * `window.print()` — диалог WebView2 с предпросмотром, выбором принтера
 * и «Сохранить как PDF». Своего диалога нет, новой зависимости нет,
 * политика безопасности окна та же (Р-200).
 */

const ROOT_ID = 'zn-print-root';
const STYLE_ID = 'zn-print-style';

/** Поле страницы на случай, если в теме записано что-то не то. */
const FALLBACK_MARGIN = '20mm';

/**
 * Поле страницы из токена — в правило `@page`.
 *
 * Переменные CSS в `@page` не действуют, поэтому значение подставляется
 * в текст правила. Токен приходит из файла темы, и пропускается только
 * длина: иначе строка из чужой темы дописала бы в стиль окна что угодно.
 */
export function pageMargin(value: string | undefined): string {
  const text = (value ?? '').trim();
  return /^\d+(\.\d+)?(mm|cm|in|pt|px)$/.test(text) ? text : FALLBACK_MARGIN;
}

/** Весь стиль печати одним текстом: документ, режим печати, поле страницы. */
export function printStyles(margin: string): string {
  return `${documentCss}\n${printCss}\n@page { margin: ${pageMargin(margin)}; }\n`;
}

/**
 * Документ для вкладки: заметка — как её показывает превью, код — строками
 * с раскраской и номерами (как на экране у этой вкладки), картинка —
 * на лист.
 *
 * Заметка печатается документом, даже когда превью выключено: печать —
 * «отдать на бумагу», как экспорт, и одна команда не должна давать разное
 * в зависимости от переключателя вида на экране.
 */
export async function documentFor(tab: Tab): Promise<Converted> {
  if (tab.meta.kind === 'image') {
    const source = tab.image?.source ?? (await imageSource(tab.meta.id));
    const alt = escapeHtml(tab.meta.title);
    return { html: `<div class="zn-picture"><img src="${escapeHtml(source)}" alt="${alt}"></div>`, problems: [] };
  }

  const text = tab.editor?.state.doc.toString() ?? '';
  const language = languageOf(tab);

  if (language?.id === 'markdown') {
    return markdownToHtml(text, {
      callouts: calloutLookup(),
      sourcePath: tab.meta.path,
      loadImage: previewImage,
      loadEmbed: previewEmbed,
    });
  }

  const numbered = lineNumbersOn({ setting: lineNumbersSetting(), markdown: false });
  return codeToHtml(text, language?.id ?? null, numbered);
}

/**
 * Напечатать документ.
 *
 * Документ встаёт в окно контейнером рядом с приложением, на контейнере —
 * токены светлой темы (бумага светлая всегда, решение владельца). Режим
 * печати прячет всё, кроме контейнера. Заголовок окна на время печати —
 * имя файла: его диалог ставит в колонтитул.
 *
 * Убирается всё по `afterprint` — он приходит и после печати, и после
 * отмены. Если диалог не откроется вовсе, скрытый контейнер останется
 * до следующей печати, и та его заменит.
 */
export async function printDocument(html: string, title: string): Promise<string[]> {
  const appearance = await printAppearance();

  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = printStyles(appearance.tokens['space-print-page'] ?? FALLBACK_MARGIN);

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'zn-print-root';
  for (const [name, value] of Object.entries(appearance.tokens)) {
    root.style.setProperty(`--zn-${name}`, value);
  }

  // Разметка — из вывода HTML, а не из файла как есть: текст экранирован,
  // сырой HTML — белым списком без атрибутов (Р-262), адреса — знакомых
  // схем (Р-264).
  const article = document.createElement('article');
  article.className = 'zn-doc';
  article.innerHTML = html;
  root.append(article);

  document.head.append(style);
  document.body.append(root);

  // Картинки строками `data:` раскодируются не сразу, а предпросмотр
  // снимается с того, что уже нарисовано: без ожидания на листе вышли бы
  // пустые рамки.
  await Promise.all(
    Array.from(root.querySelectorAll('img')).map((image) => image.decode().catch(() => undefined)),
  );
  await document.fonts.ready;

  const previousTitle = document.title;
  document.title = title;
  window.addEventListener(
    'afterprint',
    () => {
      root.remove();
      style.remove();
      document.title = previousTitle;
    },
    { once: true },
  );

  window.print();
  return appearance.problems;
}

/**
 * Заголовок листа: его диалог ставит в колонтитул, а «Сохранить в формате
 * PDF» — в имя файла. Заметка — без `.md`: «План.pdf», а не «План.md.pdf»;
 * у кода расширение — часть имени, `main.rs` остаётся `main.rs`.
 */
export function pageTitle(name: string, markdown: boolean): string {
  return markdown ? name.replace(/\.(md|markdown|mdx)$/i, '') : name;
}

/** Напечатать вкладку. Возвращает, что пошло не так, как настроено. */
export async function printTab(tab: Tab): Promise<string[]> {
  const built = await documentFor(tab);
  const markdown = tab.meta.kind === 'text' && languageOf(tab)?.id === 'markdown';
  const themeProblems = await printDocument(built.html, pageTitle(tab.meta.title, markdown));
  return [...themeProblems, ...built.problems];
}
