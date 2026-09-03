import { message } from '@tauri-apps/plugin-dialog';

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
 * Ссылка ведёт в заметку. Висячая — создаёт её и открывает (Р-098): жест тот
 * же, и это единственное толкование, при котором он не бесполезен. Р-049 это
 * не нарушает — `Ctrl`+щелчок по висячей ссылке и есть явная команда.
 *
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
  // Буфер без файла на диске: непонятно, где создавать и от чего считать путь.
  if (!from) return;

  const resolved = await ipc.resolveLink(target.value, from);
  if (resolved) {
    await openPath(resolved.path);
    return;
  }

  await createByLink(target.value, from);
}

/**
 * Создать заметку по висячей ссылке и открыть её.
 *
 * Переспроса нет: диалог на каждое создание превратил бы привычный жест
 * в процедуру, а действие обратимо — файл пустой и виден в дереве.
 */
async function createByLink(target: string, from: string): Promise<void> {
  let path: string;
  try {
    path = await ipc.createNote(target, from);
  } catch (error) {
    // Отказ бывает содержательным: запретный знак в имени, выход за пределы
    // проекта, файл появился только что. Молчать здесь нельзя — человек
    // нажал и ждёт новую заметку.
    await message(String(error), { title: 'ZeroNote', kind: 'error' });
    return;
  }

  // Ссылка перестала быть висячей — запомненные ответы про неё врут.
  // Индекс узнает о файле сам, от слежения за диском, но это произойдёт
  // позже, а подчеркнуть ссылку правильно надо сейчас.
  const { forgetResolved } = await import('../editor/wikilinks');
  forgetResolved();

  await openPath(path);
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
