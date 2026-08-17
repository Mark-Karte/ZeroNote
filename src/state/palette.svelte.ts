import * as ipc from '../ipc/index';
import type { FileHit } from '../ipc/index';
import { openPath } from './tabs.svelte';

/**
 * Быстрое открытие по имени.
 *
 * Запрос уходит в ядро на каждое нажатие — без задержки. Нечёткое совпадение
 * по десяти тысячам имён стоит доли миллисекунды, а задержка в палитре
 * ощущается сразу: список должен успевать за набором.
 */

export const palette = $state<{
  open: boolean;
  query: string;
  items: FileHit[];
  selected: number;
}>({
  open: false,
  query: '',
  items: [],
  selected: 0,
});

/** Номер последнего запроса: ответы могут прийти не в том порядке, в каком ушли. */
let latest = 0;

export async function refresh(): Promise<void> {
  const mine = ++latest;
  const items = await ipc.findFiles(palette.query, 50);

  // Ответ на устаревший запрос выбрасываем: иначе в списке окажется выдача
  // для того, что пользователь уже дописал.
  if (mine !== latest) return;

  palette.items = items;
  palette.selected = 0;
}

export function open(): void {
  palette.open = true;
  // Запрос не сбрасываем: повторное открытие обычно означает «то же самое,
  // но я промахнулся мимо строки».
  void refresh();
}

export function close(): void {
  palette.open = false;
}

export function move(delta: number): void {
  if (palette.items.length === 0) return;
  const count = palette.items.length;
  // По кругу: список короткий, и упираться в край неприятно.
  palette.selected = (palette.selected + delta + count) % count;
}

export async function accept(): Promise<void> {
  const item = palette.items[palette.selected];
  if (!item) return;

  close();
  await openPath(item.path);
}
