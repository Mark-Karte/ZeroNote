/**
 * Куда бросают вкладку (задача 77).
 *
 * Вынесено из компонента ради теста, как и перестановка внутри полосы
 * (`tab-drag.ts`): геометрия — то, что проверяется числами.
 *
 * Зоны — как в VS Code: четверть у края означает «разделить область
 * с этой стороны», середина — «перенести в эту область», полоса вкладок —
 * «поставить на это место».
 */

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Доля от края, за которой сброс означает разделение. */
const EDGE = 0.25;

export function dropZone(box: Box, x: number, y: number): DropZone {
  if (box.width <= 0 || box.height <= 0) return 'center';
  const fx = (x - box.left) / box.width;
  const fy = (y - box.top) / box.height;

  // Ближний край побеждает: у угла выбирается тот, к которому ближе.
  const toLeft = fx;
  const toRight = 1 - fx;
  const toTop = fy;
  const toBottom = 1 - fy;
  const nearest = Math.min(toLeft, toRight, toTop, toBottom);
  if (nearest >= EDGE) return 'center';

  if (nearest === toLeft) return 'left';
  if (nearest === toRight) return 'right';
  if (nearest === toTop) return 'top';
  return 'bottom';
}

/**
 * На какое место в чужой полосе встанет вкладка: перед первой, чья середина
 * правее указателя. За последней — в конец.
 */
export function insertIndex(tabs: { left: number; width: number }[], x: number): number {
  let index = 0;
  for (const tab of tabs) {
    if (x < tab.left + tab.width / 2) break;
    index += 1;
  }
  return index;
}
