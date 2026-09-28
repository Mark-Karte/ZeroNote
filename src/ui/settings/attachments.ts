/**
 * Настройка `[notes] attachments` (задача 146) для окна параметров:
 * строка файла — выбор из четырёх и имя папки.
 *
 * Строка записывается значениями Obsidian: `./` — папка заметки, `./имя` —
 * вложенная папка рядом с ней, `/` — корень проекта, `имя` — одна папка
 * проекта. Проверяет её ядро при чтении файла: негодное значение окно
 * покажет жалобой, как любую другую.
 */

import { t } from '../../l10n';

export type PlaceKind = 'note' | 'beside' | 'root' | 'folder';

export interface Place {
  kind: PlaceKind;
  /** Имя папки у `beside` и `folder`; у остальных пусто. */
  name: string;
}

/**
 * Имя папки, когда его выбирают впервые, — на языке окна: «Вложения»
 * по-русски (решение владельца на задаче 146), `attachments` по-английски,
 * как у Obsidian (задача 153).
 */
export function defaultFolder(): string {
  return t('settings.attachments.default');
}

export function placeOf(value: string): Place {
  const text = value.trim().replace(/\\/g, '/');
  if (text === '' || text === '.' || text === './') return { kind: 'note', name: '' };
  if (text === '/') return { kind: 'root', name: '' };
  if (text.startsWith('./')) return { kind: 'beside', name: text.slice(2).replace(/\/+$/, '') };
  return { kind: 'folder', name: text.replace(/^\//, '').replace(/\/+$/, '') };
}

export function valueOf(place: Place): string {
  const name = place.name.trim() || defaultFolder();
  switch (place.kind) {
    case 'note':
      return './';
    case 'root':
      return '/';
    case 'beside':
      return `./${name}`;
    case 'folder':
      return name;
  }
}
