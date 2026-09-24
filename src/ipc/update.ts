import { Channel, invoke } from '@tauri-apps/api/core';

import type { DownloadEvent } from '../ui/download';

/**
 * Обновление из GitHub — команды ядра (Р-257).
 *
 * В сеть ходит ядро, и только по нажатию (Р-118, Р-130). Окно лишь
 * спрашивает и показывает; загрузку ядро умеет снять по-настоящему.
 */

export type CheckOutcome =
  | { kind: 'upToDate' }
  | { kind: 'found'; version: string; notes: string | null }
  | { kind: 'cancelled' };

/** `ready` — скачано и подпись сошлась; `cancelled` — сняли отменой. */
export type DownloadOutcome = 'ready' | 'cancelled';

export const checkUpdate = (timeoutMs: number): Promise<CheckOutcome> =>
  invoke('check_update', { timeoutMs });

export function downloadUpdate(
  timeoutMs: number,
  onEvent: (event: DownloadEvent) => void,
): Promise<DownloadOutcome> {
  const channel = new Channel<DownloadEvent>();
  channel.onmessage = onEvent;
  return invoke('download_update', { timeoutMs, onEvent: channel });
}

/** Снять идущую проверку или загрузку. Нечего снимать — ничего не будет. */
export const cancelUpdate = (): Promise<void> => invoke('cancel_update');

/** На Windows завершает процесс: обещание не разрешится. */
export const installUpdate = (): Promise<void> => invoke('install_update');
