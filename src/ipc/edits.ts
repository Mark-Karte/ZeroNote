import { invoke } from '@tauri-apps/api/core';

/**
 * Правка чужих файлов пачкой: план замены и применение правок.
 *
 * Одни и те же типы обслуживают две задачи — переименование с обновлением
 * ссылок (48) и замену по проекту (88). Правка это тройка «где, что было,
 * что станет», и кто её посчитал, ей безразлично.
 */

/** Одна правка в файле. */
export interface TextEdit {
  /**
   * Смещение в байтах — в раскодированном тексте, а не в байтах файла.
   * Для UTF-8 это одно и то же, для однобайтовой кодировки — нет.
   */
  offset: number;
  was: string;
  becomes: string;
}

/** Что изменится в одном файле. */
export interface FileEdits {
  path: string;
  /** Путь внутри корня — его и показывают человеку. */
  inside: string;
  edits: TextEdit[];
}

/** Строка с совпадением: что видно в списке до записи. */
export interface PreviewLine {
  line: number;
  text: string;
}

/** Что изменится в одном файле при замене. */
export interface ReplaceFile extends FileEdits {
  rootId: number;
  /** Первые строки с совпадениями, не все: файл бывает и с тысячей. */
  preview: PreviewLine[];
}

/** План замены по проекту. */
export interface ReplacePlan {
  files: ReplaceFile[];
  total: number;
  scanned: number;
  /** Файлы с совпадениями, которые не читаются без потерь. Не правятся. */
  lossy: string[];
  /** Обход прервали — это начало плана, а не план. */
  stopped: boolean;
  /** Совпадений больше, чем приложение берётся показать. */
  overflow: boolean;
}

/** Что вышло из применения правок. */
export interface ApplyOutcome {
  problems: string[];
  /** Правки, возвращающие всё как было. */
  undo: FileEdits[];
}

/**
 * Посчитать, что изменится. Ничего не меняет.
 *
 * Идёт по тем же файлам, в которых ищет поиск по проекту, и потому стоит
 * секунды на больших хранилищах. Прерывается `cancelReplace`.
 */
export const planReplace = (
  query: string,
  replacement: string,
  matchCase: boolean,
  wholeWord: boolean,
): Promise<ReplacePlan> =>
  invoke('plan_replace', { query, replacement, matchCase, wholeWord });

/** Прервать идущий обход. */
export const cancelReplace = (): Promise<void> => invoke('cancel_replace');

/**
 * Поправить файлы по плану.
 *
 * Возвращает жалобы на то, что не вышло, и правки для отмены — по ним
 * замена откатывается (`state/replace`).
 */
export const applyEdits = (files: FileEdits[]): Promise<ApplyOutcome> =>
  invoke('apply_edits', { files });
