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

/** Файл, найденный по имени. */
export interface FileHit {
  rootId: number;
  path: string;
  name: string;
  /** Позиции совпавших букв в `name`, в символах. */
  matched: number[];
  score: number;
}

/**
 * Быстрое открытие: нечёткий поиск по именам.
 *
 * Пустой запрос выдаёт список файлов, а не пустоту: палитра при открытии
 * должна что-то показывать.
 */
export const findFiles = (query: string, limit?: number): Promise<FileHit[]> =>
  invoke('find_files', { query, limit: limit ?? null });

/** Куда ведёт `[[ссылка]]`. */
export interface Resolved {
  path: string;
  name: string;
}

/** Кто и как сослался на файл. */
export interface Backlink {
  rootId: number;
  path: string;
  name: string;
  /** Как ссылка записана в тексте — вместе с разделом и подписью. */
  text: string;
  embed: boolean;
}

/** Файл, помеченный тегом. */
export interface Tagged {
  rootId: number;
  path: string;
  name: string;
}

/** Куда ведёт ссылка из этого файла. `null` — ссылка висячая. */
export const resolveLink = (target: string, from: string): Promise<Resolved | null> =>
  invoke('resolve_link', { target, from });

/**
 * Какие из этих ссылок ведут в существующие заметки.
 *
 * Пачкой: редактор спрашивает про все ссылки видимой части сразу.
 */
export const resolveLinks = (targets: string[], from: string): Promise<boolean[]> =>
  invoke('resolve_links', { targets, from });

export const backlinks = (path: string): Promise<Backlink[]> =>
  invoke('backlinks', { path });

/** Тег и сколько файлов им помечено. */
export interface TagHit {
  tag: string;
  count: number;
}

/** Теги проекта под запрос. Пустой запрос — самые частые. */
export const findTags = (query: string, limit?: number): Promise<TagHit[]> =>
  invoke('find_tags', { query, limit: limit ?? null });

/** Файлы с этим тегом; вложенные теги считаются. */
export const filesWithTag = (tag: string, limit?: number): Promise<Tagged[]> =>
  invoke('files_with_tag', { tag, limit: limit ?? null });

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
