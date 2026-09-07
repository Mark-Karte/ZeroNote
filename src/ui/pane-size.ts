import type { Direction } from '../ipc/layout';
import { activePane } from '../state/panes.svelte';

/**
 * Поместятся ли две области на месте одной (Р-212).
 *
 * Размеры знает только разметка, поэтому спрашивается она: элемент области
 * и токен наименьшего размера из вычисленного стиля. Разделение, после
 * которого обе половины уже предела, не выполняется — команда молча
 * ничего не делает, а в меню гаснет; сброс на край такой области считается
 * сбросом в середину.
 */
export function canSplitPane(paneId: number, direction: Direction): boolean {
  const element = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
  if (!element) return false;

  const min = parseFloat(getComputedStyle(element).getPropertyValue('--zn-control-pane-min-size'));
  const size = direction === 'row' ? element.clientWidth : element.clientHeight;
  return size >= 2 * (Number.isFinite(min) ? min : 0);
}

/** То же для активной области — команде «разделить». Без вкладки делить нечего. */
export function canSplit(direction: Direction): boolean {
  const pane = activePane();
  if (pane.active === null) return false;
  return canSplitPane(pane.id, direction);
}

/** Тот же предел для перетаскивания границы: доля, при которой обе стороны не уже предела. */
export function clampRatio(ratio: number, total: number, min: number): number {
  const floor = total > 0 ? Math.min(0.5, min / total) : 0;
  const low = Math.max(0.1, floor);
  const high = Math.min(0.9, 1 - floor);
  return Math.min(high, Math.max(low, ratio));
}
