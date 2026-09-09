import type { PopupItem } from '../ui/popup-item';

/**
 * Открытое контекстное меню.
 *
 * Меню одно на окно и рисуется в `AppShell`, а не там, где по нему щёлкнули.
 * Иначе оно оказалось бы внутри прокручиваемой панели или обрезанного по
 * рамке блока — и уехало бы вместе с содержимым или пропало под краем.
 */

export interface OpenMenu {
  items: PopupItem[];
  at: { x: number; y: number };
  pick: (id: string) => void;
}

export const contextMenu = $state<{ open: OpenMenu | null }>({ open: null });

/**
 * Показать меню в точке щелчка.
 *
 * Событие останавливается здесь же: обработчик окна снимает меню вебвью
 * везде, а по остановке распространения понимает, что своё меню уже нашлось
 * и предлагать общее не надо.
 *
 * Пустой набор пунктов меню не открывает. Меню без единого пункта хуже
 * отсутствия меню: оно обещает, что здесь что-то можно сделать.
 */
export function showMenu(
  event: MouseEvent,
  items: PopupItem[],
  pick: (id: string) => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  if (items.length === 0) {
    contextMenu.open = null;
    return;
  }
  contextMenu.open = { items, at: { x: event.clientX, y: event.clientY }, pick };
}

/**
 * Показать меню в заданной точке.
 *
 * Нужно там, где выбор начинает не щелчок, а команда: список заготовок
 * по `Вставить шаблон` показывается у курсора, а мыши в этот момент
 * в деле нет вовсе.
 */
export function showMenuAt(
  at: { x: number; y: number },
  items: PopupItem[],
  pick: (id: string) => void,
): void {
  if (items.length === 0) {
    contextMenu.open = null;
    return;
  }
  contextMenu.open = { items, at, pick };
}

export function hideMenu(): void {
  contextMenu.open = null;
}
