import { invoke } from '@tauri-apps/api/core';

/**
 * Режим измерительного стенда, включаемый аргументами командной строки.
 * В обычном запуске `mode` равен null и приложение ведёт себя как приложение.
 */
export interface BenchConfig {
  mode: 'startup' | 'ipc' | 'open' | 'tree' | 'index' | null;
  outPath: string | null;
}

export function benchConfig(): Promise<BenchConfig> {
  return invoke<BenchConfig>('bench_config');
}

/**
 * Сообщить ядру, что интерфейс готов принимать ввод.
 * Возвращает миллисекунды, прошедшие с входа в `main()`.
 * В режиме `--bench startup` ядро само запишет число в файл и завершит процесс.
 */
export function benchReady(): Promise<number> {
  return invoke<number>('bench_ready');
}

/** Сгенерировать полезную нагрузку и выбросить. Базовая линия: стоимость самой генерации. */
export function benchGenOnly(mib: number, cyrillic: boolean): Promise<number> {
  return invoke<number>('bench_gen_only', { mib, cyrillic });
}

/** Сгенерировать и отдать во фронтенд обычным путём Tauri (сериализация в JSON). */
export function benchGenText(mib: number, cyrillic: boolean): Promise<string> {
  return invoke<string>('bench_gen_text', { mib, cyrillic });
}

/** Сгенерировать и отдать сырыми байтами (в обход JSON), декодировать на месте. */
export async function benchGenBytes(mib: number, cyrillic: boolean): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('bench_gen_bytes', { mib, cyrillic });
}

/** Отправить текст из фронтенда в ядро. Это путь сброса черновика и сохранения файла. */
export function benchSinkText(text: string): Promise<number> {
  return invoke<number>('bench_sink_text', { text });
}

/**
 * Замер открытия файла целиком в ядре: диск → байты → определение кодировки →
 * раскодирование. Границы IPC в этом пути нет, поэтому и в замере её нет.
 */
export function benchRunOpen(): Promise<string> {
  return invoke<string>('bench_run_open');
}

/**
 * Замер дерева: чтение одной папки и, отдельно, полный обход.
 *
 * Дерево читает по папке, поэтому его цена — первое число. Второе нужно
 * индексу задачи 11 и меряется заранее, чтобы обещание про тридцать секунд
 * не оказалось выдумкой.
 */
export function benchRunTree(): Promise<string> {
  return invoke<string>('bench_run_tree');
}

/** Замер индексации: обход, первая индексация, повторный проход, поиск. */
export function benchRunIndex(): Promise<string> {
  return invoke<string>('bench_run_index');
}

export function benchWriteReport(path: string, content: string): Promise<void> {
  return invoke<void>('bench_write_report', { path, content });
}

export function benchExit(): Promise<void> {
  return invoke<void>('bench_exit');
}
