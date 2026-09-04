import { invoke } from '@tauri-apps/api/core';

export type EncodingId =
  | 'utf8'
  | 'utf16-le'
  | 'utf16-be'
  | 'windows1251'
  | 'windows1252'
  | 'ibm866'
  | 'koi8-r';

export type LineEnding = 'lf' | 'cr-lf' | 'cr';

/** Сведения о буфере, которыми владеет ядро. Содержимого здесь нет — см. Р-002. */
export interface Buffer {
  id: number;
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

export const listBuffers = (): Promise<Buffer[]> => invoke('list_buffers');

export const newBuffer = (): Promise<Buffer> => invoke('new_buffer');

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

export const closeBuffer = (id: number): Promise<boolean> =>
  invoke('close_buffer', { id });

export const reorderBuffer = (id: number, to: number): Promise<Buffer[]> =>
  invoke('reorder_buffer', { id, to });

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
  active: number | null;
  roots: import('./roots').Root[];
  sidebar: boolean;
  /** Ноль — ширина не подгонялась, действует значение из темы. */
  sidebarWidth: number;
  /** Какая панель была показана: `tree` или `search`. */
  sidebarPanel: string;
  notices: string[];
}

export const saveSession = (
  views: ViewState[],
  active: number | null,
  sidebar: boolean,
  sidebarWidth: number,
  sidebarPanel: string,
): Promise<void> =>
  invoke('save_session', { views, active, sidebar, sidebarWidth, sidebarPanel });

export const flushDrafts = (entries: { id: number; text: string }[]): Promise<void> =>
  invoke('flush_drafts', { entries });

export const dropDraft = (id: number): Promise<void> => invoke('drop_draft', { id });

export const restoreSession = (): Promise<RestoredSession> => invoke('restore_session');

/** Показать путь в проводнике: папку открыть, файл выделить в его папке. */
export const revealPath = (path: string): Promise<void> => invoke('reveal_path', { path });

/** Сказать ядру, что открытый файл переехал: переименовали его или папку над ним. */
export const moveBuffer = (id: number, path: string): Promise<Buffer[]> =>
  invoke('move_buffer', { id, path });
