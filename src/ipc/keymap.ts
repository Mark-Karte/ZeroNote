import { invoke } from '@tauri-apps/api/core';

/**
 * Раскладка клавиш: чтение и переназначение.
 *
 * Канонический список команд и умолчания — в ядре (`keymap/mod.rs`).
 * Здесь только вызовы: и «какая сейчас раскладка», и «запиши вот такую».
 */

export interface CommandInfo {
  id: string;
  title: string;
  /** Чем нажимается сейчас. Пусто — только палитра и меню. */
  bindings: string[];
  /** Чем нажималось бы без файла пользователя. */
  defaults: string[];
}

export interface KeymapState {
  /** Сочетание в приведённом виде → идентификатор команды. */
  bindings: Record<string, string>;
  commands: CommandInfo[];
  problems: string[];
}

export const keymapState = (): Promise<KeymapState> => invoke('keymap_state');

/** Назначить команде сочетание. `null` — снять вовсе. */
export const setBinding = (command: string, binding: string | null): Promise<KeymapState> =>
  invoke('set_binding', { command, binding });

/** Вернуть команде умолчание. */
export const resetBinding = (command: string): Promise<KeymapState> =>
  invoke('reset_binding', { command });

/** Убрать все переназначения разом. */
export const resetKeymap = (): Promise<KeymapState> => invoke('reset_keymap');
