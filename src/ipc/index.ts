import { invoke } from '@tauri-apps/api/core';

/** Ход индексации. `total` = 0 при running — идёт обход, число ещё не известно. */
export interface IndexProgress {
  running: boolean;
  done: number;
  total: number;
}

/** Одно совпадение поиска по содержимому. */
export interface Hit {
  rootId: number;
  path: string;
  name: string;
  /** Отрывок с пометками совпадений — см. MARK_START и MARK_END. */
  snippet: string;
}

/**
 * Чем в отрывке помечено совпадение.
 *
 * Управляющие знаки, а не разметка: в текстах пользователя встречается что
 * угодно, включая разметку, и отличить свою метку от чужого текста надо
 * наверняка. Записаны escape-последовательностями, а не самими знаками:
 * невидимый символ в исходнике не переживёт ни одной небрежной правки.
 *
 * Значения обязаны совпадать с `index/query.rs` — это проверяет тест
 * `tests/index.test.ts`.
 */
export const MARK_START = '\u0001';
export const MARK_END = '\u0002';

/** Событие ядра: ход индексации изменился. */
export const INDEX_PROGRESS = 'index-progress';

export const indexProgress = (): Promise<IndexProgress> => invoke('index_progress');

export const indexCount = (rootId: number): Promise<number> =>
  invoke('index_count', { rootId });

/** Отменить индексацию — и текущую, и то, что стоит в очереди. */
export const cancelIndex = (): Promise<void> => invoke('cancel_index');

export const reindexRoot = (rootId: number): Promise<void> =>
  invoke('reindex_root', { rootId });

/** Поиск по содержимому. `rootId` не задан — по всем корням сразу. */
export const searchProject = (
  query: string,
  rootId?: number,
  limit?: number,
): Promise<Hit[]> =>
  invoke('search_project', { query, rootId: rootId ?? null, limit: limit ?? null });
