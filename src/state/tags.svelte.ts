import * as ipc from '../ipc/index';
import type { TagHit } from '../ipc/index';
import { showPanel } from './roots.svelte';
import { openTag } from './project-search.svelte';

/**
 * Теги проекта: что вообще есть и чем сколько помечено.
 *
 * Панель отвечает на вопрос «какие теги я завожу», на который палитра
 * в режиме `#` не отвечает: там надо знать, что набирать. Ответ на второй
 * вопрос — «что помечено вот этим» — уже есть, и он живёт в панели поиска;
 * дублировать список файлов здесь незачем.
 */

/** Сколько тегов показывать. Больше, чем в палитре: панель для просмотра. */
const LIMIT = 200;

export const tags = $state<{
  items: TagHit[];
  /** Чем сужен список. Пустая строка — все теги, самые частые сверху. */
  filter: string;
  loading: boolean;
  /** Список хоть раз собирали: до этого «тегов нет» — не ответ, а незнание. */
  asked: boolean;
}>({ items: [], filter: '', loading: false, asked: false });

/** Номер запроса: ответы приходят не в том порядке, в каком ушли. */
let latest = 0;

export async function refresh(): Promise<void> {
  const mine = ++latest;
  tags.loading = true;

  try {
    const found = await ipc.findTags(tags.filter, LIMIT);
    if (mine !== latest) return;
    tags.items = found;
    tags.asked = true;
  } finally {
    if (mine === latest) tags.loading = false;
  }
}

/**
 * Показать файлы с этим тегом.
 *
 * Список уезжает в панель поиска — туда же, куда его отправляет палитра
 * (Р-140). Двух мест, показывающих одно и то же, быть не должно: у панели
 * поиска уже есть открытие файла, показ пути и память о том, что нашлось.
 */
export async function showFiles(tag: string): Promise<void> {
  showPanel('search');
  await openTag(tag);
}
