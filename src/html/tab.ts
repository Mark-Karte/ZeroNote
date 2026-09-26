import { drawDiagram, paperTheme, type Drawn } from '../editor/diagram';
import type { DiagramTheme } from '../editor/diagram-render';
import { lineNumbersOn } from '../editor/line-numbers';
import { printAppearance } from '../ipc/appearance';
import { imageSource, previewEmbed, previewImage } from '../ipc/files';
import { calloutLookup } from '../state/callouts.svelte';
import { lineNumbersSetting } from '../state/settings.svelte';
import { languageOf, type Tab } from '../state/tabs.svelte';
import {
  codeToHtml,
  markdownToHtml,
  type ConvertContext,
  type Converted,
} from './convert';
import { escapeHtml } from './escape';

/**
 * Документ вкладки — одна дорога для печати (задача 109) и экспорта
 * (задачи 110 и 111). Связывает вывод HTML (задача 108) с тем, что знает
 * окно: текст вкладки, её язык, список коллаутов, правило номеров строк,
 * тему бумаги для схем.
 */

/** Заметка ли на вкладке — от этого зависит, документ это или код. */
export function isMarkdownTab(tab: Tab): boolean {
  return tab.meta.kind === 'text' && languageOf(tab)?.id === 'markdown';
}

/**
 * Откуда вывод берёт то, чего нет в тексте заметки: одно на печать,
 * экспорт и копирование.
 */
export function convertContext(tab: Tab): ConvertContext {
  return {
    callouts: calloutLookup(),
    sourcePath: tab.meta.path,
    loadImage: previewImage,
    loadEmbed: previewEmbed,
    drawDiagram: paperDiagrams(),
  };
}

/**
 * Схемы для бумаги (задача 118): тот же mermaid, что у превью, но цвета —
 * светлой темы пары, как у всего документа (Р-268), а не окна.
 *
 * Тема спрашивается у ядра один раз на документ и только при первой схеме:
 * заметке без схем незачем ни вопрос, ни mermaid.
 */
function paperDiagrams(): (source: string) => Promise<Drawn> {
  let theme: Promise<DiagramTheme> | null = null;
  return async (source) => {
    theme ??= printAppearance().then((appearance) => paperTheme(appearance.tokens));
    return drawDiagram(source, await theme);
  };
}

/**
 * Документ для вкладки: заметка — как её показывает превью, код — строками
 * с раскраской и номерами (как на экране у этой вкладки), картинка —
 * на лист.
 *
 * Заметка выходит документом, даже когда превью выключено: печать
 * и экспорт — «отдать», и одна команда не должна давать разное
 * в зависимости от переключателя вида на экране (Р-269).
 */
export async function documentFor(tab: Tab): Promise<Converted> {
  if (tab.meta.kind === 'image') {
    const source = tab.image?.source ?? (await imageSource(tab.meta.id));
    const alt = escapeHtml(tab.meta.title);
    return {
      html: `<div class="zn-picture"><img src="${escapeHtml(source)}" alt="${alt}"></div>`,
      problems: [],
    };
  }

  const text = tab.editor?.state.doc.toString() ?? '';

  if (isMarkdownTab(tab)) return markdownToHtml(text, convertContext(tab));

  const numbered = lineNumbersOn({ setting: lineNumbersSetting(), markdown: false });
  return codeToHtml(text, languageOf(tab)?.id ?? null, numbered);
}

/**
 * Заголовок документа: печать ставит его в колонтитул и в имя PDF,
 * экспорт — в `<title>`. Заметка — без `.md`: «План.pdf», а не
 * «План.md.pdf»; у кода расширение — часть имени, `main.rs` остаётся
 * `main.rs`.
 */
export function pageTitle(name: string, markdown: boolean): string {
  return markdown ? name.replace(/\.(md|markdown|mdx)$/i, '') : name;
}
