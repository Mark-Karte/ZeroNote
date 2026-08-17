import { tick } from 'svelte';

import * as ipc from '../ipc/index';
import type { Hit } from '../ipc/index';
import { openPath } from './tabs.svelte';
import { search as fileSearch, findNext } from './search.svelte';

/**
 * Поиск по содержимому проекта.
 *
 * Запрос идёт с задержкой — в отличие от быстрого открытия. Там сравниваются
 * имена в памяти, здесь работает FTS5 по всему проекту: обходится дороже,
 * а набирают запрос по букве.
 */

const DELAY_MS = 150;

export const projectSearch = $state<{
  query: string;
  hits: Hit[];
  running: boolean;
  /** Поиск отработал хотя бы раз — чтобы отличить «ничего не нашлось»
   *  от «ещё не искали». */
  searched: boolean;
}>({
  query: '',
  hits: [],
  running: false,
  searched: false,
});

/**
 * Просьба к панели забрать фокус в поле ввода.
 *
 * Счётчик, а не признак: повторное нажатие Ctrl+Shift+F при уже открытой
 * панели тоже должно возвращать фокус, а признак «нужен фокус» во второй раз
 * не изменился бы и обработчик не сработал.
 */
export const searchFocusRequest = $state({ value: 0 });

/** Открыть панель поиска и забрать фокус. */
export function focusSearch(): void {
  searchFocusRequest.value += 1;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let latest = 0;

async function run(): Promise<void> {
  timer = null;
  const mine = ++latest;
  const query = projectSearch.query;

  if (query.trim() === '') {
    projectSearch.hits = [];
    projectSearch.searched = false;
    projectSearch.running = false;
    return;
  }

  projectSearch.running = true;
  try {
    const hits = await ipc.searchProject(query);
    // Ответ на устаревший запрос выбрасываем.
    if (mine !== latest) return;
    projectSearch.hits = hits;
    projectSearch.searched = true;
  } finally {
    if (mine === latest) projectSearch.running = false;
  }
}

/** Запрос изменился: искать после паузы. */
export function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    void run();
  }, DELAY_MS);
}

/** Искать немедленно — нажали Enter. */
export async function runNow(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  await run();
}

/**
 * Открыть файл и встать на совпадение.
 *
 * Номер строки в индексе не хранится (Р-063): он устаревает при первой же
 * правке файла снаружи. Вместо этого по открытому файлу запускается обычный
 * поиск — тот же код, что за Ctrl+F. Файл на диске всегда свежее индекса,
 * так что попадание точнее.
 */
export async function openHit(hit: Hit): Promise<void> {
  await openPath(hit.path);

  // Ищем первое слово запроса, а не запрос целиком: несколько слов индекс
  // ищет как «и», они могут стоять в разных концах файла, и поиск фразы
  // не нашёл бы ничего.
  const first = projectSearch.query.trim().split(/\s+/)[0] ?? '';
  if (first === '') return;

  fileSearch.term = first;
  fileSearch.regexp = false;
  fileSearch.wholeWord = false;
  fileSearch.caseSensitive = false;

  // Ждём, пока редактор получит открытый документ: подставить запрос
  // в предыдущий файл — значит подсветить не то и не там.
  await tick();
  findNext();
}
