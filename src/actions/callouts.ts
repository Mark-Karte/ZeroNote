import { message } from '@tauri-apps/plugin-dialog';

import { caretPoint, editorView } from '../editor/current';
import { cssColorOf, iconOf } from '../editor/callouts';
import { asCommand, insertCallout } from '../editor/markdown-format';
import { calloutById, calloutList } from '../state/callouts.svelte';
import { showMenuAt } from '../state/menu.svelte';

/**
 * Вставка коллаута (задача 103).
 *
 * Вставляется тип и подпись из списка человека: `> [!tip] Совет`. Подпись
 * — текст заметки, его увидит и Obsidian (Р-178 не задет: превью слов
 * не сочиняет, они в файле). Выделенное становится телом коллаута.
 */

/** Вставить коллаут данного типа — с панели, где у каждого своя кнопка. */
export function insertCalloutOf(id: string): void {
  const view = editorView();
  const callout = calloutById(id);
  if (!view || !callout) return;
  asCommand((state) => insertCallout(state, callout.id, callout.title))(view);
}

/**
 * Показать список коллаутов у курсора и вставить выбранный — команда
 * `md.callout`. Меню, а не отдельный экран: список короткий, и выбрать
 * из него — одно движение. Значок в меню того же цвета, что карточка.
 */
export async function pickCallout(): Promise<void> {
  if (!editorView()) {
    await message('Вставлять коллаут некуда: откройте заметку.', { title: 'ZeroNote' });
    return;
  }

  const list = calloutList();
  if (list.length === 0) {
    await message(
      'Список коллаутов пуст. Добавьте их во вкладке «Коллауты» окна параметров.',
      { title: 'ZeroNote' },
    );
    return;
  }

  showMenuAt(
    caretPoint(),
    list.map((callout) => ({
      id: callout.id,
      label: callout.title || callout.id,
      hint: callout.id,
      icon: iconOf(callout.icon),
      tint: cssColorOf(callout.color),
    })),
    (id) => insertCalloutOf(id),
  );
}
