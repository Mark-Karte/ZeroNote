import { invoke } from '@tauri-apps/api/core';

/** Недавно открытый файл. */
export interface RecentEntry {
  path: string;
  /** Когда открыли, в миллисекундах эпохи. */
  openedAt: number;
}

export const recentFiles = (): Promise<RecentEntry[]> => invoke('recent_files');
