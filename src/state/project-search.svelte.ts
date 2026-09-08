import { tick } from 'svelte';

import * as ipc from '../ipc/index';
import type { Hit } from '../ipc/index';
import * as search from '../ipc/edits';
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
  /**
   * В какой папке искать. `null` — во всех сразу.
   *
   * Выбор появился после задачи 88 по замечанию владельца: одинаковые
   * библиотеки лежат в разных проектах, и замена в одном из них не должна
   * доезжать до остальных. Поиск и замена смотрят один и тот же выбор —
   * иначе список показывал бы одно, а правилось бы другое (Р-220).
   *
   * Живёт в памяти, а не в сессии: выбор папки — это про текущее занятие,
   * и застать его завтра там же было бы неожиданностью.
   */
  rootId: number | null;
  /**
   * Переключатели запроса (задача 89).
   *
   * `regexp` меняет не только смысл строки, но и путь: выражение ищется
   * обходом файлов, а не индексом, — FTS5 ищет слова и выражений не понимает.
   * Отсюда и правило «Enter — искать»: обход стоит чтения файлов, и делать
   * его на каждую букву недописанного выражения незачем.
   *
   * `matchCase` и `wholeWord` при обычном поиске список не меняют: индекс
   * ищет слова и регистра не различает. На замену они действуют всегда —
   * замена ищет точный текст сама (задача 88).
   */
  matchCase: boolean;
  wholeWord: boolean;
  regexp: boolean;
  /** Выражение не разобрано — текст отказа из ядра. */
  error: string;
  /** Найденного больше, чем показано. */
  limited: boolean;
}>({
  query: '',
  hits: [],
  running: false,
  searched: false,
  rootId: null,
  matchCase: false,
  wholeWord: false,
  regexp: false,
  error: '',
  limited: false,
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
  projectSearch.error = '';
  projectSearch.limited = false;

  if (query.trim() === '') {
    projectSearch.hits = [];
    projectSearch.searched = false;
    projectSearch.running = false;
    return;
  }

  // Запрос, начинающийся с решётки, — это поиск по тегу. Так же ведёт себя
  // Obsidian, и набрать `#тег` в поле поиска — самое очевидное, что можно
  // сделать, увидев тег в тексте. У выражения решётка — обычный знак,
  // поэтому режим тега проверяется только в обычном поиске.
  if (!projectSearch.regexp && query.trimStart().startsWith('#')) {
    await searchByTag(query.trim().slice(1));
    return;
  }

  projectSearch.running = true;
  try {
    if (projectSearch.regexp) {
      const found = await search.searchExpression(
        query,
        projectSearch.matchCase,
        projectSearch.wholeWord,
        projectSearch.rootId,
      );
      if (mine !== latest) return;
      projectSearch.hits = found.hits;
      projectSearch.limited = found.limited;
      projectSearch.searched = true;
      return;
    }

    const hits = await ipc.searchProject(query, projectSearch.rootId ?? undefined);
    // Ответ на устаревший запрос выбрасываем.
    if (mine !== latest) return;
    projectSearch.hits = hits;
    projectSearch.searched = true;
  } catch (error) {
    if (mine !== latest) return;
    // Отказ из ядра — это разобранное выражение, а не сбой: показываем его
    // словами и оставляем список пустым.
    projectSearch.error = String(error);
    projectSearch.hits = [];
    projectSearch.searched = true;
  } finally {
    if (mine === latest) projectSearch.running = false;
  }
}

/**
 * Запрос изменился: искать после паузы.
 *
 * Выражение по букве не ищется вовсе (задача 89): каждый такой запрос —
 * обход файлов с чтением, а недописанное выражение либо не разбирается,
 * либо находит совсем не то. Ищем по Enter, и панель об этом говорит.
 */
export function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  if (projectSearch.regexp) return;

  timer = setTimeout(() => {
    void run();
  }, DELAY_MS);
}

/**
 * Показать файлы с тегом и написать в поле то, что их нашло.
 *
 * Точка входа для тех, кто выбрал тег снаружи: палитра в режиме `#` и панель
 * тегов. Сам поиск по набранному в поле зовёт `searchByTag` напрямую — там
 * поле трогать нельзя, пользователь в нём печатает.
 */
export async function openTag(tag: string): Promise<void> {
  // Поле обязано показывать то, что нашло список. Без этой строки панель
  // открывалась с чужим запросом в поле и файлами, к нему не относящимися,
  // — и понять, откуда они взялись, было неоткуда.
  projectSearch.query = `#${tag}`;
  await searchByTag(tag);
}

/**
 * Показать файлы с этим тегом.
 *
 * Тег — не текст: FTS5 срезает решётку при разборе на слова, и поиск по
 * содержимому нашёл бы все упоминания слова, а не только помеченные им
 * заметки. Поэтому отдельный запрос к таблице тегов.
 */
export async function searchByTag(tag: string): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }

  const mine = ++latest;
  projectSearch.running = true;
  try {
    const files = await ipc.filesWithTag(tag);
    if (mine !== latest) return;

    // Отрывок у тега свой: показывать нечего, кроме самого тега.
    projectSearch.hits = files.map((file) => ({
      rootId: file.rootId,
      path: file.path,
      name: file.name,
      snippet: `#${tag}`,
    }));
    projectSearch.searched = true;
  } finally {
    if (mine === latest) projectSearch.running = false;
  }
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
