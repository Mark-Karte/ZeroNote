import * as ipc from '../ipc/index';
import type { Backlink } from '../ipc/index';
import type { Target } from '../editor/wikilinks';
import { activeTab, openPath } from './tabs.svelte';
import { showPanel } from './roots.svelte';
import { projectSearch, searchByTag } from './project-search.svelte';

/**
 * Связи между заметками: обратные ссылки и переход по ссылке.
 *
 * Панель обратных ссылок показывает только настоящие `[[ссылки]]`. Упоминания
 * голым текстом («кто написал это имя, не сославшись») требуют полнотекстового
 * поиска на каждое открытие файла и дают много шума — решение по В35.
 */

export const links = $state<{
  /** Для какого файла собраны обратные ссылки. */
  path: string | null;
  items: Backlink[];
  loading: boolean;
}>({
  path: null,
  items: [],
  loading: false,
});

let latest = 0;

/** Пересобрать обратные ссылки для активной вкладки. */
export async function refreshBacklinks(): Promise<void> {
  const tab = activeTab();
  const path = tab?.meta.path ?? null;

  if (path === null) {
    links.path = null;
    links.items = [];
    return;
  }

  const mine = ++latest;
  links.loading = true;
  try {
    const items = await ipc.backlinks(path);
    // Ответ на устаревший запрос выбрасываем: пока он шёл, вкладку могли
    // переключить, и показывать чужие связи нельзя.
    if (mine !== latest) return;
    links.path = path;
    links.items = items;
  } finally {
    if (mine === latest) links.loading = false;
  }
}

/**
 * Перейти по тому, что под курсором.
 *
 * Ссылка ведёт в заметку; висячая не ведёт никуда и молчит — предлагать
 * создать файл мы не будем, это запись в папку пользователя (Р-049).
 * Тег открывает поиск по этому тегу, как в Obsidian.
 */
export async function follow(target: Target): Promise<void> {
  if (target.kind === 'tag') {
    showPanel('search');
    projectSearch.query = `#${target.value}`;
    await searchByTag(target.value);
    return;
  }

  const tab = activeTab();
  const from = tab?.meta.path;
  if (!from) return;

  const resolved = await ipc.resolveLink(target.value, from);
  if (!resolved) return;

  await openPath(resolved.path);
}

/** Перейти по ссылке под курсором — команда с клавиатуры. */
export async function followAtCursor(): Promise<void> {
  const { editorView } = await import('../editor/current');
  const { targetAt } = await import('../editor/wikilinks');

  const view = editorView();
  if (!view) return;

  const target = targetAt(view, view.state.selection.main.head);
  if (target) await follow(target);
}
