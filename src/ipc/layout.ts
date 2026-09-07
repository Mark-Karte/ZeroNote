import { invoke } from '@tauri-apps/api/core';

/**
 * Раскладка окна — дерево областей (Р-207).
 *
 * Приходит из ядра и в ядре меняется: всякая команда ниже возвращает дерево
 * целиком, и фронтенд заменяет им свою копию. «Что изменилось» не передаётся
 * нарочно — расхождение между копией и оригиналом так не накапливается.
 */

export type Direction = 'row' | 'column';

export interface PaneNode {
  kind: 'pane';
  id: number;
  /** Порядок в списке — порядок вкладок на полосе. */
  tabs: number[];
  active: number | null;
}

export interface SplitNode {
  kind: 'split';
  id: number;
  direction: Direction;
  /** Доля первого потомка. */
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = PaneNode | SplitNode;

export interface Layout {
  root: LayoutNode;
  activePane: number;
  nextId: number;
}

export const layoutState = (): Promise<Layout> => invoke('layout_state');

export const setActivePane = (pane: number): Promise<Layout> =>
  invoke('set_active_pane', { pane });

export const setActiveTab = (pane: number, id: number): Promise<Layout> =>
  invoke('set_active_tab', { pane, id });

export const reorderTab = (pane: number, id: number, to: number): Promise<Layout> =>
  invoke('reorder_tab', { pane, id, to });

/** Убрать вкладку из одной области; буфер остаётся жить в других (Р-209). */
export const removeTab = (pane: number, id: number): Promise<Layout> =>
  invoke('remove_tab', { pane, id });

/** Разделить область. С буфером новая область получает его зеркало. */
export const splitPane = (
  pane: number,
  direction: Direction,
  id: number | null,
): Promise<Layout> => invoke('split_pane', { pane, direction, id });

export const closePane = (pane: number): Promise<Layout> => invoke('close_pane', { pane });

export const moveTab = (
  id: number,
  from: number,
  to: number,
  at: number | null,
): Promise<Layout> => invoke('move_tab', { id, from, to, at });

export const setSplitRatio = (split: number, ratio: number): Promise<Layout> =>
  invoke('set_split_ratio', { split, ratio });
