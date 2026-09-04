import type { EditorView } from '@codemirror/view';

import { findNotes, linkTarget, type FileHit } from '../ipc/index';
import { insertionFor, linkContextAt, type LinkContext } from '../editor/suggest';
import { linkSuggestEnabled } from './settings.svelte';

/**
 * Подсказка имён заметок при `[[` (Р-132).
 *
 * Список стоит у курсора и не забирает фокус: человек продолжает печатать,
 * а подсказка идёт за ним. Отсюда и устройство — состояние окна, а не окно:
 * редактор сообщает, что вокруг курсора, здесь решается, показывать ли список
 * и что в нём, а рисует его `ui/Suggest.svelte`.
 */

export interface SuggestState {
  open: boolean;
  items: FileHit[];
  selected: number;
  /** Место курсора на экране: по нему список и ставится. */
  caret: { left: number; top: number; bottom: number } | null;
  /** Что набрано после `[[` — по нему подсвечиваются совпадения. */
  query: string;
}

export const suggest = $state<SuggestState>({
  open: false,
  items: [],
  selected: 0,
  caret: null,
  query: '',
});

/**
 * Кому принадлежит нынешний список.
 *
 * Обычные переменные, а не руны: интерфейс от них не зависит, а реактивность
 * заставляла бы пересчитывать разметку на каждое нажатие впустую.
 */
let view: EditorView | null = null;
let source: string | null = null;
let context: LinkContext | null = null;

/**
 * Номер запроса. Ответы приходят не в том порядке, в каком спрошены: короткий
 * запрос по десяти тысячам имён считается дольше длинного, и ответ на «п»
 * легко обгоняет ответ на «планы». Без этого счётчика список показывал бы
 * позавчерашнюю выдачу.
 */
let generation = 0;

/**
 * Начало ссылки, у которой подсказку прогнали Escape'ом.
 *
 * Без этой памяти Escape закрывал бы список ровно до следующего сообщения
 * от расширения — а они приходят и на набор, и на **смену фокуса окна**.
 * Контекст при этом прежний, и список возвращается сам: достаточно
 * переключиться на другое окно и обратно. Прогнали — значит здесь не надо,
 * и повторять вопрос на каждую букву незачем.
 *
 * Помнится именно позиция: ушёл курсор из этой ссылки — память чистится,
 * и в следующей подсказка снова работает.
 */
let dismissed: number | null = null;

/**
 * Прогнать подсказку до конца этой ссылки.
 *
 * Отдельно от `close`: закрытие по щелчку мимо или по потере фокуса — это
 * «сейчас не до тебя», а Escape — «не надо здесь». Разница видна ровно
 * в том, вернётся ли список сам.
 */
export function dismiss(): void {
  const here = context?.from ?? null;
  close();
  dismissed = here;
}

export function close(): void {
  generation += 1;
  suggest.open = false;
  suggest.items = [];
  suggest.selected = 0;
  suggest.caret = null;
  suggest.query = '';
  view = null;
  source = null;
  context = null;
}

/** Место курсора на экране. `null` — курсор за пределами отрисованного. */
function caretOf(target: EditorView, position: number): SuggestState['caret'] {
  const coords = target.coordsAtPos(position);
  if (!coords) return null;
  return { left: coords.left, top: coords.top, bottom: coords.bottom };
}

/**
 * Редактор сообщает, что происходит вокруг курсора.
 *
 * Условий четыре, и каждое отсекает случай, в котором подсказка была бы
 * неправдой: выключенная настройка, не-markdown, файл без пути на диске
 * (сослаться из него нельзя — ссылки разрешаются относительно файла)
 * и отсутствие самих скобок.
 */
export function reportContext(input: {
  context: LinkContext | null;
  path: string | null;
  markdown: boolean;
  view: EditorView;
}): void {
  if (!input.context || !input.markdown || input.path === null || !linkSuggestEnabled()) {
    if (suggest.open || context) close();
    // Курсор ушёл из ссылки — прогонять больше нечего.
    dismissed = null;
    return;
  }

  // Ту же ссылку, у которой подсказку прогнали, второй раз не показываем.
  if (dismissed !== null && dismissed !== input.context.from) dismissed = null;
  if (dismissed !== null) {
    if (suggest.open) close();
    return;
  }

  view = input.view;
  source = input.path;
  context = input.context;
  suggest.query = input.context.query;
  suggest.caret = caretOf(input.view, input.context.from);

  void search(input.context.query, input.path);
}

async function search(query: string, from: string): Promise<void> {
  const mine = (generation += 1);
  const found = await findNotes(query, from, 20).catch(() => [] as FileHit[]);

  // Пока ходили в индекс, курсор мог уехать, вкладка — смениться, подсказка —
  // закрыться. Ответ на отменённый запрос выбрасываем молча.
  if (mine !== generation) return;

  suggest.items = found;
  // Выбор всегда на первой строке: список пересобран, и «второй пункт»
  // прошлого списка не имеет к новому никакого отношения.
  suggest.selected = 0;
  // Показывать пустую рамку незачем: подсказка — это подсказка, а не ответ
  // на вопрос. Не нашлось — её просто нет, и клавиши достаются редактору.
  suggest.open = found.length > 0 && suggest.caret !== null;
}

export function move(delta: number): void {
  const count = suggest.items.length;
  if (count === 0) return;
  // По кругу, как в палитре: список короткий, и упираться в его край
  // раздражает сильнее, чем проскочить мимо.
  suggest.selected = (suggest.selected + delta + count) % count;
}

/**
 * Вставить выбранное имя ссылкой.
 *
 * Текст ссылки спрашивается у ядра, а не составляется из имени файла
 * (Р-134): в проекте бывают две заметки с одним именем, и короткое имя
 * привело бы в ближайшую — то есть не в ту, которую выбрали.
 */
export async function accept(): Promise<boolean> {
  const target = suggest.items[suggest.selected];
  const editor = view;
  const from = source;
  const place = context;
  if (!target || !editor || from === null || !place) return false;

  close();

  const text = await linkTarget(target.path, from).catch(() => null);
  // Сослаться нельзя — файл в другом проекте или вне проектов. Вставлять
  // имя наугад значило бы создать висячую ссылку молча, поэтому не вставляем
  // ничего: набранное остаётся на месте.
  if (text === null) return false;

  // Ходили в ядро — за это время документ мог измениться. Правим только если
  // под курсором всё ещё та самая недописанная ссылка.
  const now = linkContextAt(editor.state);
  if (!now || now.from !== place.from || now.query !== place.query) return false;

  const edit = insertionFor(now, text);
  editor.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.cursor },
    scrollIntoView: true,
    userEvent: 'input.complete',
  });
  editor.focus();
  return true;
}
