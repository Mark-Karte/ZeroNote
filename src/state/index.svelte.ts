import * as ipc from '../ipc/index';
import type { IndexProgress } from '../ipc/index';

/**
 * Ход индексации.
 *
 * Состояние приходит событиями из ядра — фронтенд его не вычисляет и не
 * опрашивает: опрос во время индексации десяти тысяч файлов означал бы
 * обращение к ядру каждые несколько кадров ради числа, которое ядро и так
 * знает.
 */
export const indexing = $state<{ progress: IndexProgress }>({
  progress: { running: false, done: 0, total: 0 },
});

export function applyProgress(value: IndexProgress): void {
  indexing.progress = value;
}

/** Спросить состояние один раз — при запуске, до первого события. */
export async function refreshProgress(): Promise<void> {
  indexing.progress = await ipc.indexProgress();
}

export async function cancel(): Promise<void> {
  await ipc.cancelIndex();
  // Не ждём события: отмена должна быть видна сразу, иначе кажется,
  // что кнопка не сработала.
  indexing.progress = { running: false, done: 0, total: 0 };
}
