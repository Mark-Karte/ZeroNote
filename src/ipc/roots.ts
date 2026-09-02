import { invoke } from '@tauri-apps/api/core';

/** Корень рабочего пространства — папка, открытая как проект. */
export interface Root {
  id: number;
  path: string;
  name: string;
  hasProjectFile: boolean;
  /** В папке есть `.obsidian` — можно предложить перенос настроек. */
  hasObsidianConfig: boolean;
  /** Папка сейчас читается. `false` — например, отключён сетевой диск. */
  available: boolean;
  /** Что не так с zeronote.toml. Показывается полосой предупреждений. */
  problems?: string[];
}

export const listRoots = (): Promise<Root[]> => invoke('list_roots');

/** Добавить папку корнем. В саму папку при этом не пишется ничего (Р-049). */
export const addRoot = (path: string): Promise<Root> => invoke('add_root', { path });

export const removeRoot = (id: number): Promise<boolean> => invoke('remove_root', { id });

/** Перечитать файлы проектов и доступность папок. */
export const refreshRoots = (): Promise<Root[]> => invoke('refresh_roots');

/** Создать zeronote.toml — только по явной команде пользователя. */
export const createProjectFile = (id: number): Promise<Root> =>
  invoke('create_project_file', { id });

/** Что переходник Obsidian готов перенести. */
export interface ObsidianPreview {
  detected: boolean;
  /** Правила игнорирования, готовые к переносу. */
  rules: string[];
  /** Фильтры, которые перенести нельзя, — как записаны в Obsidian. */
  skipped: string[];
  /** Файл проекта уже есть: переносим не мы, а пользователь руками. */
  projectFileExists: boolean;
}

/** Посмотреть, что можно перенести. Только чтение — инвариант 2. */
export const obsidianPreview = (id: number): Promise<ObsidianPreview> =>
  invoke('obsidian_preview', { id });

/** Создать zeronote.toml с перенесёнными настройками Obsidian. */
export const obsidianImport = (id: number): Promise<Root> =>
  invoke('obsidian_import', { id });
