import type { DropZone } from '../ui/pane-drop';

/**
 * Куда сейчас тащат вкладку (задача 77).
 *
 * Тащит полоса одной области, а подсвечивает зону другая, и договориться
 * они могут только через общее состояние. Сами они друг о друге не знают.
 */
export interface DropTarget {
  pane: number;
  zone: DropZone | 'strip';
  /** Место в полосе — только для зоны `strip`. */
  index: number;
}

export const dropTarget = $state<{ value: DropTarget | null }>({ value: null });

export function setDropTarget(target: DropTarget): void {
  const current = dropTarget.value;
  // Не переписывать то же самое: каждая запись — перерисовка подсветки.
  if (
    current &&
    current.pane === target.pane &&
    current.zone === target.zone &&
    current.index === target.index
  ) {
    return;
  }
  dropTarget.value = target;
}

export function clearDropTarget(): void {
  if (dropTarget.value !== null) dropTarget.value = null;
}
