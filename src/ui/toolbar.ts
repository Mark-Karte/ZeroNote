/**
 * Панель инструментов: что стоит на ней над данной вкладкой (задача 102).
 *
 * Состав — список из файла настроек (`[toolbar] items`): идентификаторы
 * команд и три служебных слова. Здесь только правила, без показа, — чтобы
 * их можно было проверить тестом, не поднимая окна.
 *
 * Два правила, и они разные по смыслу:
 *
 * * **Кнопка, неприменимая к виду вкладки, прячется.** Жирный над кодом
 *   не бывает применим никогда, и полоса погасших значков над каждым
 *   файлом `.rs` сообщала бы только одно — «эта панель не для тебя».
 * * **Кнопка, неприменимая к состоянию, гаснет** (Р-189): отмене нечего
 *   отменять, назад идти некуда. Здесь исчезновение сдвигало бы соседей,
 *   и человек попадал бы не туда, куда целился.
 */

import type { TabKind } from '../ipc/files';

/** Значение `[toolbar] show`: над какими вкладками стоит панель. */
export type ToolbarShow = 'always' | 'text' | 'markdown' | 'never';
/** Значение `[toolbar] width` — правило колонки живёт рядом с колонкой. */
export type { ToolbarWidth } from '../editor/readable';
/** Значение `[toolbar] size`. */
export type ToolbarSize = 'small' | 'normal' | 'large';

export type ToolbarEntry =
  | { kind: 'command'; id: string }
  | { kind: 'separator' }
  | { kind: 'spacer' }
  | { kind: 'path' };

/** Служебные слова состава. Тот же список — `TOOLBAR_WORDS` в ядре. */
export const TOOLBAR_WORDS = ['separator', 'spacer', 'path'] as const;

/** Где стоит панель: вид вкладки и язык текста. */
export interface ToolbarPlace {
  tab: TabKind;
  markdown: boolean;
}

export function entryOf(item: string): ToolbarEntry {
  if (item === 'separator' || item === 'spacer' || item === 'path') return { kind: item };
  return { kind: 'command', id: item };
}

/** Чему нужна команда, чтобы иметь смысл. */
export type Need = 'markdown' | 'text' | 'any';

/**
 * Команды, которым нужен текст, — не по одной строке на каждую, а по
 * семейству: правка и поиск по файлу работают только с текстом, разметка —
 * только с markdown. Отдельные команды из `view.*` перечислены руками:
 * у этого семейства есть и общие для окна (боковая панель, области).
 */
const TEXT_PREFIXES = ['edit.', 'search.'];
const TEXT_COMMANDS = new Set([
  'view.bookmark',
  'view.bookmark-next',
  'view.bookmark-previous',
  'view.bookmarks-clear',
  'view.fold',
  'view.unfold',
  'view.fold-all',
  'view.unfold-all',
  'view.go-to-bracket',
  'view.invisibles',
]);
const MARKDOWN_COMMANDS = new Set(['view.live-preview', 'project.follow-link']);

export function needOf(id: string): Need {
  if (id.startsWith('md.') || MARKDOWN_COMMANDS.has(id)) return 'markdown';
  if (TEXT_PREFIXES.some((prefix) => id.startsWith(prefix)) || TEXT_COMMANDS.has(id)) {
    return 'text';
  }
  return 'any';
}

function fits(id: string, place: ToolbarPlace): boolean {
  const need = needOf(id);
  if (need === 'any') return true;
  if (place.tab !== 'text') return false;
  return need === 'text' || place.markdown;
}

/**
 * Стоит ли панель над этой вкладкой.
 *
 * Над параметрами её нет никогда, даже при `always`: это страница
 * приложения, а не документ, и кнопки над ней действовали бы на файл,
 * которого на экране нет.
 */
export function toolbarShown(show: ToolbarShow, place: ToolbarPlace): boolean {
  if (place.tab === 'settings') return false;
  switch (show) {
    case 'always':
      return true;
    case 'text':
      return place.tab === 'text';
    case 'markdown':
      return place.tab === 'text' && place.markdown;
    case 'never':
      return false;
  }
}

/**
 * Что видно на панели над этой вкладкой.
 *
 * Спрятанные кнопки оставляют после себя черты: «отмена | [разметка] |
 * путь» над кодом превратилось бы в «отмена | | путь». Поэтому черта
 * выживает только между двумя кнопками — не в начале, не в конце, не рядом
 * с другой чертой и не рядом с распоркой: черта у пустоты ничего
 * не разделяет.
 */
export function visibleEntries(items: string[], place: ToolbarPlace): ToolbarEntry[] {
  const kept = items
    .map(entryOf)
    .filter((entry) => entry.kind !== 'command' || fits(entry.id, place));

  const out: ToolbarEntry[] = [];
  for (const entry of kept) {
    if (entry.kind === 'separator') {
      const last = out[out.length - 1];
      if (!last || last.kind === 'separator' || last.kind === 'spacer') continue;
    }
    if (entry.kind === 'spacer' && out[out.length - 1]?.kind === 'separator') out.pop();
    out.push(entry);
  }
  while (out[out.length - 1]?.kind === 'separator') out.pop();
  return out;
}

/** Что сейчас можно сделать — для кнопок, которые гаснут. */
export interface ToolbarAbility {
  undo: boolean;
  redo: boolean;
  back: boolean;
  forward: boolean;
}

export function dimmed(id: string, can: ToolbarAbility): boolean {
  switch (id) {
    case 'edit.undo':
      return !can.undo;
    case 'edit.redo':
      return !can.redo;
    case 'view.back':
      return !can.back;
    case 'view.forward':
      return !can.forward;
    default:
      return false;
  }
}

/**
 * Подпись вместо значка. У заголовков она короче и понятнее рисунка:
 * «H4» читается сразу, а буква с цифрой в шестнадцать точек — нет.
 */
const TEXT_LABELS: Record<string, string> = {
  'md.heading-1': 'H1',
  'md.heading-2': 'H2',
  'md.heading-3': 'H3',
  'md.heading-4': 'H4',
  'md.heading-5': 'H5',
  'md.heading-6': 'H6',
};

export function textLabelOf(id: string): string | null {
  return TEXT_LABELS[id] ?? null;
}
