import type { EditorState } from '@codemirror/state';

import { activeHeading, outlineOf, type Heading } from '../editor/outline';

/**
 * Оглавление открытой заметки.
 *
 * Считается во фронтенде, а не в ядре: документ живёт здесь (Р-002), и гонять
 * его через IPC ради списка заголовков означало бы копировать мегабайты
 * на каждое нажатие.
 *
 * Разделение задержек тут не украшение. Список заголовков — проход по всему
 * документу, и он идёт с задержкой, как счётчик совпадений поиска. А вот
 * подсветка того заголовка, под которым стоит курсор, — проход по уже
 * готовому списку из десятков строк, и задерживать её значит показывать
 * не тот раздел, в котором пользователь находится.
 */

/** Через сколько после последней правки пересобирать список. */
const DELAY = 150;

export const outline = $state<{
  items: Heading[];
  /** Номер заголовка над курсором или −1. */
  active: number;
  /** У вкладки есть оглавление: markdown и файл открыт. */
  available: boolean;
}>({ items: [], active: -1, available: false });

let timer: ReturnType<typeof setTimeout> | null = null;
/** Чья это была вкладка: смена вкладки пересобирает список сразу. */
let known: number | null = null;

function recompute(state: EditorState): void {
  outline.items = outlineOf(state.doc);
  outline.active = activeHeading(outline.items, cursorLine(state));
}

function cursorLine(state: EditorState): number {
  return state.doc.lineAt(state.selection.main.head).number;
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Сообщить оглавлению, что показывает редактор.
 *
 * Зовётся из панели: пока она закрыта, компонента нет, и документ никто
 * не обходит. Это и есть ответ на вопрос «не дорого ли считать оглавление
 * на каждую правку» — за закрытой панелью оно не считается вовсе.
 */
export function update(
  tabId: number | null,
  state: EditorState | null,
  markdown: boolean,
): void {
  if (state === null || !markdown) {
    clearTimer();
    known = null;
    outline.items = [];
    outline.active = -1;
    outline.available = false;
    return;
  }

  outline.available = true;

  // Другая вкладка — показывать её оглавление надо сразу. Задержка здесь
  // означала бы, что после переключения полторы десятых секунды в панели
  // висит содержание предыдущей заметки.
  if (tabId !== known) {
    clearTimer();
    known = tabId;
    recompute(state);
    return;
  }

  // Подсветка — сразу, по уже собранному списку.
  outline.active = activeHeading(outline.items, cursorLine(state));

  clearTimer();
  timer = setTimeout(() => {
    timer = null;
    recompute(state);
  }, DELAY);
}

/** Забыть всё: вкладок не осталось или оглавление больше не показывается. */
export function forget(): void {
  clearTimer();
  known = null;
  outline.items = [];
  outline.active = -1;
  outline.available = false;
}
