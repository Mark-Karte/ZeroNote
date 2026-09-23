import { listen } from '@tauri-apps/api/event';

import * as ipc from '../ipc/callouts';
import type { CalloutsState } from '../ipc/callouts';
import { lookupFor, type CalloutDef, type CalloutLookup } from '../editor/callouts';

/**
 * Список коллаутов (задача 103).
 *
 * Своего хранилища нет: список читается из `data/callouts.toml`, правка
 * из окна параметров уезжает туда же, и перечитывается он тем же событием,
 * что оформление, — ядро следит за файлом (Р-077).
 */
export const callouts = $state<{
  state: CalloutsState | null;
  /** Что пошло не так при последнем действии. */
  problem: string | null;
}>({ state: null, problem: null });

export async function loadCallouts(): Promise<void> {
  try {
    callouts.state = await ipc.calloutsState();
  } catch (error) {
    callouts.problem = String(error);
  }
}

export async function startCallouts(): Promise<void> {
  await loadCallouts();
  await listen('appearance-changed', () => {
    void loadCallouts();
  });
}

/** Список коллаутов. Пока не приехал — пуст, и всё рисуется заметкой. */
export function calloutList(): CalloutDef[] {
  return callouts.state?.callouts ?? [];
}

/** Как рисовать тип — для превью. */
export function calloutLookup(): CalloutLookup {
  return lookupFor(calloutList());
}

export function calloutById(id: string): CalloutDef | null {
  return calloutList().find((callout) => callout.id === id) ?? null;
}

/**
 * Записать коллаут и принять ответ ядра сразу, не дожидаясь слежения
 * за файлом: иначе полсекунды в списке стояло бы прежнее.
 */
export async function saveCallout(original: string | null, callout: CalloutDef): Promise<boolean> {
  try {
    callouts.state = await ipc.saveCallout(original, callout);
    callouts.problem = null;
    return true;
  } catch (error) {
    callouts.problem = String(error);
    return false;
  }
}

export async function removeCallout(id: string): Promise<void> {
  try {
    callouts.state = await ipc.removeCallout(id);
    callouts.problem = null;
  } catch (error) {
    callouts.problem = String(error);
  }
}
