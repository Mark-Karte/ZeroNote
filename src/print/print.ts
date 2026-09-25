import documentCss from '../html/document.css?inline';
import printCss from './print.css?inline';

import { documentFor, isMarkdownTab, pageTitle } from '../html/tab';
import { printAppearance } from '../ipc/appearance';
import type { Tab } from '../state/tabs.svelte';

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

/** Документ, поставленный в окно для печати. */
export interface Mounted {
  /** Что пошло не так, как настроено: тема пары не нашлась или тёмная. */
  problems: string[];
  /** Убрать документ из окна. Можно звать сколько угодно раз. */
  unmount: () => void;
}

/**
 * Поставить документ в окно — для печати через диалог и для PDF одной
 * командой (задача 111): печатает его один и тот же движок WebView2.
 *
 * Документ встаёт контейнером рядом с приложением, на контейнере —
 * токены светлой темы (бумага светлая всегда, решение владельца). Режим
 * печати прячет всё, кроме контейнера; на экране контейнера не видно.
 */
export async function mountDocument(html: string): Promise<Mounted> {
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

  // Картинки строками `data:` раскодируются не сразу, а лист снимается
  // с того, что уже нарисовано: без ожидания на нём вышли бы пустые рамки.
  await Promise.all(
    Array.from(root.querySelectorAll('img')).map((image) => image.decode().catch(() => undefined)),
  );
  await document.fonts.ready;

  return {
    problems: appearance.problems,
    unmount: () => {
      root.remove();
      style.remove();
    },
  };
}

/**
 * Напечатать документ через диалог WebView2.
 *
 * Заголовок окна на время печати — имя файла: его диалог ставит
 * в колонтитул. Убирается всё по `afterprint` — он приходит и после
 * печати, и после отмены. Если диалог не откроется вовсе, скрытый
 * контейнер останется до следующей печати, и та его заменит.
 */
export async function printDocument(html: string, title: string): Promise<string[]> {
  const mounted = await mountDocument(html);

  const previousTitle = document.title;
  document.title = title;
  window.addEventListener(
    'afterprint',
    () => {
      mounted.unmount();
      document.title = previousTitle;
    },
    { once: true },
  );

  window.print();
  return mounted.problems;
}

/** Напечатать вкладку. Возвращает, что пошло не так, как настроено. */
export async function printTab(tab: Tab): Promise<string[]> {
  const built = await documentFor(tab);
  const title = pageTitle(tab.meta.title, isMarkdownTab(tab));
  const themeProblems = await printDocument(built.html, title);
  return [...themeProblems, ...built.problems];
}
