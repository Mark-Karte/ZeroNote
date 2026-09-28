import { message } from '@tauri-apps/plugin-dialog';
import { tick } from 'svelte';

import * as ipc from '../ipc/index';
import type { Backlink, Resolved } from '../ipc/index';
import type { Target } from '../editor/wikilinks';
import { editorViewOf } from '../editor/current';
import { findSubpath, missingSubpath } from '../editor/subpath';
import { activePane } from './panes.svelte';
import { activeTab, goToPlace, tabById, tryOpenPath, visibleState } from './tabs.svelte';
import { notify } from './notices.svelte';
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

  // Раздел этой же заметки (задача 148): `[[#Раздел]]`, `[текст](#Раздел)`.
  // Пути не нужно — годится и буфер без файла.
  if (target.value === '') {
    if (tab) revealIn(tab.meta.id, target.subpath);
    return;
  }

  const from = tab?.meta.path;
  // Буфер без файла на диске: непонятно, где создавать и от чего считать путь.
  if (!from) return;

  // Отказ здесь не молчит (С9 ревизии): переход зовут `void`-ом
  // по щелчку и F12, и пойманной ошибки никто бы не увидел.
  const failed = (error: unknown): void =>
    notify(`Ссылка не разрешилась: ${error instanceof Error ? error.message : String(error)}`);

  // Ссылка markdown на файл (задача 148): путь от папки заметки, как
  // у картинки. Висячую не создаём: адрес мог быть чем угодно — это
  // `[[ссылка]]` называет заметку, а путь только указывает на файл.
  if (target.kind === 'path') {
    let path: string | null;
    try {
      path = await ipc.resolvePathLink(target.value, from);
    } catch (error) {
      failed(error);
      return;
    }
    if (path === null) {
      notify(`Файла «${target.value}» нет`);
      return;
    }
    if (await tryOpenPath(path)) await revealOpened(path, target.subpath);
    return;
  }

  let resolved: Resolved | null;
  try {
    resolved = await ipc.resolveLink(target.value, from);
  } catch (error) {
    failed(error);
    return;
  }
  if (resolved) {
    if (await tryOpenPath(resolved.path)) await revealOpened(resolved.path, target.subpath);
    return;
  }

  // Новая заметка пуста: раздела в ней нет, и говорить об этом незачем.
  await createByLink(target.value, from);
}

/** Один ли это путь — без учёта регистра и вида черты, как у Windows. */
function samePath(a: string | null, b: string): boolean {
  const norm = (path: string): string => path.replaceAll('/', '\\').toLowerCase();
  return a !== null && norm(a) === norm(b);
}

/**
 * Показать раздел в заметке, которую только что открыли.
 *
 * Открытие меняет вкладку, а редактор получает её состояние эффектом
 * Svelte — не сразу. Прыгнуть раньше значило бы поставить курсор
 * в состояние, которое экран ещё не показал, и прокрутка потерялась бы.
 */
async function revealOpened(path: string, subpath: string): Promise<void> {
  if (subpath === '') return;
  await tick();
  const tab = activeTab();
  if (!tab || !samePath(tab.meta.path, path)) return;

  for (let frame = 0; frame < 30; frame += 1) {
    // По документу, как в `goToPlace`: состояние представления меняется
    // и без правки, а вкладка такие обновления не забирает.
    const view = editorViewOf(activePane().id);
    if (view && view.state.doc === visibleState(tab)?.doc) break;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  revealIn(tab.meta.id, subpath);
}

/**
 * Поставить курсор на раздел и показать его вверху экрана. Раздела нет —
 * заметка остаётся, где была, а полоса говорит об этом одной фразой (Р-305).
 */
function revealIn(tabId: number, subpath: string): void {
  const tab = tabById(tabId);
  const state = tab ? visibleState(tab) : null;
  if (!state) return;
  const pos = findSubpath(state.doc, subpath);
  if (pos === null) {
    notify(missingSubpath(subpath));
    return;
  }
  goToPlace({ tab: tabId, pane: activePane().id, pos }, { top: true });
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

  await tryOpenPath(path);
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
