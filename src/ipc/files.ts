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

export const setLineEnding = (id: number, lineEnding: LineEnding): Promise<Buffer> =>
  invoke('set_line_ending', { id, lineEnding });

export const setModified = (id: number, modified: boolean): Promise<void> =>
  invoke('set_modified', { id, modified });

export const saveBuffer = (
  id: number,
  text: string,
  path?: string,
): Promise<Buffer> => invoke('save_buffer', { id, text, path: path ?? null });

export const closeBuffer = (id: number): Promise<boolean> =>
  invoke('close_buffer', { id });

export const reorderBuffer = (id: number, to: number): Promise<Buffer[]> =>
  invoke('reorder_buffer', { id, to });

export const listEncodings = (): Promise<EncodingOption[]> => invoke('list_encodings');
