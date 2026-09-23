import { invoke } from '@tauri-apps/api/core';

import type { CalloutDef } from '../editor/callouts';

/** Список коллаутов из `data/callouts.toml` (задача 103). */
export interface CalloutsState {
  callouts: CalloutDef[];
  /** Что из файла не применилось. */
  problems: string[];
  path: string;
  /** Файл не читается вовсе: список — образец, править нельзя. */
  broken: string | null;
}

export const calloutsState = (): Promise<CalloutsState> => invoke('callouts_state');

/**
 * Записать коллаут. `original` — тип, под которым он лежит в файле сейчас;
 * `null` — новый.
 */
export const saveCallout = (original: string | null, callout: CalloutDef): Promise<CalloutsState> =>
  invoke('save_callout', { original, callout });

export const removeCallout = (id: string): Promise<CalloutsState> =>
  invoke('remove_callout', { id });
