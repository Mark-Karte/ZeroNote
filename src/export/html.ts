import { save as saveDialog } from '@tauri-apps/plugin-dialog';

import documentCss from '../html/document.css?inline';
import exportCss from '../html/export.css?inline';

import { escapeHtml } from '../html/escape';
import { documentFor, isMarkdownTab, pageTitle } from '../html/tab';
import { printAppearance } from '../ipc/appearance';
import { writeHtmlExport } from '../ipc/export';
import type { Tab } from '../state/tabs.svelte';
import { version } from '../version';

/**
 * Экспорт в HTML (задача 110): один файл, который открывается в любом
 * браузере и пересылается одним вложением.
 *
 * Всё внутри: стиль документа (тот же `document.css`, что у печати),
 * токены светлой темы пары (бумага светлая — и лист браузера тоже,
 * решение владельца), картинки строками `data:` (Р-264). Шрифты не
 * встраиваются: вшитые весят сотни килобайт, и в файле остаётся цепочка
 * шрифтов темы с системными запасными.
 *
 * Модуль грузится по команде, как печать: в стартовый кусок не едет.
 */

/**
 * Политика безопасности самого файла.
 *
 * Вывод и так экранирует всё и не пропускает ни скриптов, ни обработчиков
 * (Р-262, Р-264). Эта строка — второй пояс: даже если бы что-то проскочило,
 * браузер не исполнит скрипт и ничего не загрузит из сети. Разрешены
 * встроенный стиль и картинки `data:` — ровно то, из чего файл состоит.
 */
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/**
 * Токены темы — объявлениями на `:root`.
 *
 * Значение приходит из файла темы, и в стиль файла, который уйдёт
 * к чужим людям, попадает только то, что похоже на значение CSS: без
 * угловых и фигурных скобок и без точки с запятой. Иначе строка из темы
 * могла бы закрыть `<style>` и дописать в страницу своё.
 */
export function tokenBlock(tokens: Record<string, string>): string {
  const lines = Object.entries(tokens)
    .filter(([name, value]) => /^[a-z0-9-]+$/.test(name) && !/[<>{};]/.test(value))
    .map(([name, value]) => `  --zn-${name}: ${value};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/** Страница целиком. Чистая функция — проверяется тестом. */
export function exportPage(body: string, title: string, tokens: Record<string, string>): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="generator" content="ZeroNote ${version}">`,
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    tokenBlock(tokens),
    documentCss,
    exportCss,
    '</style>',
    '</head>',
    '<body>',
    `<article class="zn-doc zn-page">\n${body}\n</article>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * Куда предложить сохранить: рядом с файлом, под его именем.
 *
 * Заметка теряет `.md` — «План.html»; код расширение сохраняет —
 * «main.rs.html», чтобы рядом с исходником было видно, чей это вывод.
 * Буфер без файла — одним именем: диалог откроется там, где был в прошлый
 * раз.
 */
export function exportPath(path: string | null, title: string, markdown: boolean): string {
  const base = path ?? title;
  const stem = markdown ? base.replace(/\.(md|markdown|mdx)$/i, '') : base;
  return `${stem}.html`;
}

/**
 * Экспортировать вкладку. `null` — человек закрыл диалог, ничего не записано.
 *
 * Документ собирается **до** диалога: слишком большая заметка (Р-265)
 * должна получить отказ раньше, чем человек выберет место, а не после.
 * Отмена в диалоге стоит лишь того, что собрано зря.
 */
export async function exportTabAsHtml(
  tab: Tab,
): Promise<{ path: string; problems: string[] } | null> {
  const markdown = isMarkdownTab(tab);
  const [built, appearance] = await Promise.all([documentFor(tab), printAppearance()]);
  const page = exportPage(built.html, pageTitle(tab.meta.title, markdown), appearance.tokens);

  const target = await saveDialog({
    defaultPath: exportPath(tab.meta.path, tab.meta.title, markdown),
    filters: [{ name: 'Страница HTML', extensions: ['html', 'htm'] }],
  });
  if (!target) return null;

  await writeHtmlExport(target, page);
  return { path: target, problems: [...appearance.problems, ...built.problems] };
}
