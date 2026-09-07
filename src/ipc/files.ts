import { invoke } from '@tauri-apps/api/core';
import type { Layout } from './layout';

export type EncodingId =
  | 'utf8'
  | 'utf16-le'
  | 'utf16-be'
  | 'windows1251'
  | 'windows1252'
  | 'ibm866'
  | 'koi8-r';

export type LineEnding = 'lf' | 'cr-lf' | 'cr';

/**
 * Вид вкладки (Р-180).
 *
 * Приходит из ядра: там же лежат порядок вкладок и активная, и вторым списком
 * во фронтенде это держать нельзя — два списка разъехались бы на первом же
 * перетаскивании вкладки, и разъехались бы молча.
 *
 * Видов четыре, и каждый пришёл вместе со своим кодом: вид, которого никто
 * не создаёт, — это ветка, которую нечем проверить.
 */
export type TabKind = 'text' | 'settings' | 'image' | 'pdf';

/** Сведения о буфере, которыми владеет ядро. Содержимого здесь нет — см. Р-002. */
export interface Buffer {
  id: number;
  kind: TabKind;
  path: string | null;
  title: string;
  encoding: EncodingId;
  bom: boolean;
  eol: LineEnding;
  eolMixed: boolean;
  modified: boolean;
  readOnly: boolean;
  large: boolean;
  lossy: boolean;
  encodingConfident: boolean;
  disk: { modifiedMs: number | null; size: number } | null;
}

export type BufferWithText = Buffer & { text: string };

export interface EncodingOption {
  id: EncodingId;
  label: string;
  supportsBom: boolean;
}

/** Файлы из командной строки: «Открыть с помощью», запуск из консоли. */
export const startupPaths = (): Promise<string[]> => invoke('startup_paths');

/**
 * Второй экземпляр передал свои пути и ушёл (Р-191).
 *
 * Имя события повторяет `single::OPEN_PATHS` в ядре — как `tree-changed`
 * и `index-progress` до него.
 */
export const OPEN_PATHS = 'open-paths';

export const listBuffers = (): Promise<Buffer[]> => invoke('list_buffers');

export const newBuffer = (): Promise<Buffer> => invoke('new_buffer');

/** Вкладка параметров. Одна на окно: повторный вызов вернёт ту же. */
export const openSettingsTab = (): Promise<Buffer> => invoke('open_settings');

/**
 * Картинка вкладки адресом `data:`.
 *
 * Спрашивается показом, когда вкладка появляется на экране, и не хранится
 * нигде дольше этого (Р-193). Отказ — человеческое объяснение: файл велик,
 * не читается или не картинка вовсе.
 */
export const imageSource = (id: number): Promise<string> => invoke('image_source', { id });

/**
 * Байты PDF для показа.
 *
 * Двоичным ответом, а не строкой: pdf.js принимает массив байтов, и base64
 * здесь был бы платой в треть объёма и два преобразования ни за что (Р-196).
 * Живут они, как и байты картинки, ровно пока вкладка на экране (Р-193).
 */
export const pdfBytes = (id: number): Promise<ArrayBuffer> => invoke('pdf_bytes', { id });

/**
 * Картинка из заметки адресом `data:` — для живого превью markdown.
 *
 * `link` — путь, как его написали в разметке; `base` — путь к самой заметке,
 * от папки которой считается относительный. Разбирает путь ядро: в окне нет
 * ни файловой системы, ни правил разбора путей Windows.
 */
export const previewImage = (link: string, base: string | null): Promise<string> =>
  invoke('preview_image', { link, base });

/**
 * Открыть страницу «Приложения по умолчанию» на карточке ZeroNote.
 *
 * Умолчание назначает человек (Р-190) — кнопка лишь доводит до нужной
 * страницы Windows.
 */
export const openDefaultApps = (): Promise<void> => invoke('open_default_apps');

export const openFile = (path: string): Promise<BufferWithText> =>
  invoke('open_file', { path });

export const reloadBuffer = (id: number): Promise<BufferWithText> =>
  invoke('reload_buffer', { id });

/** «Интерпретировать как»: те же байты, другая кодировка. Буфер остаётся чистым. */
export const reinterpretEncoding = (
  id: number,
  encoding: EncodingId,
): Promise<BufferWithText> => invoke('reinterpret_encoding', { id, encoding });

/** «Преобразовать в»: текст тот же, меняется кодировка записи. Буфер грязный. */
export const convertEncoding = (
  id: number,
  encoding: EncodingId,
  text: string,
): Promise<Buffer> => invoke('convert_encoding', { id, encoding, text });

export const setBom = (id: number, bom: boolean): Promise<Buffer> =>
  invoke('set_bom', { id, bom });

export const setLineEnding = (id: number, lineEnding: LineEnding): Promise<Buffer> =>
  invoke('set_line_ending', { id, lineEnding });

export const setModified = (id: number, modified: boolean): Promise<void> =>
  invoke('set_modified', { id, modified });

export interface SaveResult {
  /** Файл на диске изменился с момента чтения. Ничего не записано. */
  conflict: boolean;
  buffer: Buffer | null;
}

export const saveBuffer = (
  id: number,
  text: string,
  path?: string,
  force = false,
): Promise<SaveResult> =>
  invoke('save_buffer', { id, text, path: path ?? null, force });

export type ExternalStatus = 'modified' | 'removed';

export interface ExternalChange {
  id: number;
  status: ExternalStatus;
}

export const checkExternal = (): Promise<ExternalChange[]> => invoke('check_external');

/** Принять состояние файла как эталонное, оставив содержимое буфера. */
export const acceptExternal = (id: number): Promise<Buffer> =>
  invoke('accept_external', { id });

/** Файл исчез, содержимое остаётся в редакторе. */
export const markDetached = (id: number): Promise<Buffer> =>
  invoke('mark_detached', { id });

/**
 * Закрыть буфер совсем. Возвращает раскладку: закрытие могло схлопнуть
 * область (Р-211), и фронтенду нужна новая форма окна.
 */
export const closeBuffer = (id: number): Promise<Layout> => invoke('close_buffer', { id });

export const listEncodings = (): Promise<EncodingOption[]> => invoke('list_encodings');

// --- Сессия и черновики (инвариант 4) ---

export interface ViewState {
  id: number;
  cursor: number;
  scrollTop: number;
  /** Язык подсветки, выбранный вручную. `null` — определять по имени файла. */
  language: string | null;
  /** Номера строк с закладками, с единицы. */
  bookmarks: number[];
}

export interface RestoredBuffer extends BufferWithText {
  cursor: number;
  scrollTop: number;
  language: string | null;
  bookmarks: number[];
}

export interface RestoredSession {
  buffers: RestoredBuffer[];
  /** Дерево областей с порядком вкладок и активной вкладкой (Р-207). */
  layout: Layout;
  roots: import('./roots').Root[];
  sidebar: boolean;
  /** Ноль — ширина не подгонялась, действует значение из темы. */
  sidebarWidth: number;
  /** Какая панель была показана: `tree` или `search`. */
  sidebarPanel: string;
  notices: string[];
}

/**
 * Записать снимок сессии. Активная вкладка и порядок вкладок не передаются:
 * ими владеет раскладка в ядре (Р-207).
 */
export const saveSession = (
  views: ViewState[],
  sidebar: boolean,
  sidebarWidth: number,
  sidebarPanel: string,
): Promise<void> => invoke('save_session', { views, sidebar, sidebarWidth, sidebarPanel });

export const flushDrafts = (entries: { id: number; text: string }[]): Promise<void> =>
  invoke('flush_drafts', { entries });

export const dropDraft = (id: number): Promise<void> => invoke('drop_draft', { id });

export const restoreSession = (): Promise<RestoredSession> => invoke('restore_session');

/** Пути, разложенные ядром на файлы и папки. */
export interface SplitPaths {
  files: string[];
  folders: string[];
}

/**
 * Разложить пути на файлы и папки — для перетаскивания в окно.
 *
 * Спрашивается у ядра: в вебвью файловой системы нет, а гадать по расширению
 * нельзя — папка с точкой в имени встречается чаще, чем кажется.
 */
export const splitPaths = (paths: string[]): Promise<SplitPaths> =>
  invoke('split_paths', { paths });

/** Показать путь в проводнике: папку открыть, файл выделить в его папке. */
export const revealPath = (path: string): Promise<void> => invoke('reveal_path', { path });

/** Сказать ядру, что открытый файл переехал: переименовали его или папку над ним. */
export const moveBuffer = (id: number, path: string): Promise<Buffer[]> =>
  invoke('move_buffer', { id, path });
