import type { EditorView } from '@codemirror/view';
import { Text } from '@codemirror/state';

import { findNotes, linkTarget, noteText, resolveLink, type FileHit } from '../ipc/index';
import { headingInsertion, insertionFor, linkContextAt, type LinkContext } from '../editor/suggest';
import { outlineOf } from '../editor/outline';
import { headingForLink, matchHeadings, type HeadingHit } from '../editor/subpath';
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
  /**
   * Что в списке: имена заметок или, после `#`, заголовки заметки
   * (задача 148).
   */
  mode: 'files' | 'headings';
  items: FileHit[];
  headings: HeadingHit[];
  selected: number;
  /** Место курсора на экране: по нему список и ставится. */
  caret: { left: number; top: number; bottom: number } | null;
  /** Что набрано после `[[` — по нему подсвечиваются совпадения. */
  query: string;
}

export const suggest = $state<SuggestState>({
  open: false,
  mode: 'files',
  items: [],
  headings: [],
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
  suggest.mode = 'files';
  suggest.items = [];
  suggest.headings = [];
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
  suggest.caret = caretOf(input.view, input.context.from);

  const heading = input.context.heading;
  if (heading) {
    suggest.query = heading.query;
    void searchHeadings(heading.note, heading.query, input.path, input.view);
    return;
  }
  suggest.query = input.context.query;
  void search(input.context.query, input.path, input.context.embed);
}

/**
 * Откуда брать заголовки: своя заметка — из редактора; другая, если она
 * открыта, — из её вкладки, со всеми несохранёнными правками; иначе — с диска
 * (`note_text`). `null` — заметки нет.
 */
async function headingSource(note: string, from: string, target: EditorView): Promise<Text | null> {
  if (note === '') return target.state.doc;
  const resolved = await resolveLink(note, from);
  if (!resolved) return null;
  // Лениво: вкладки сами зовут подсказку, и прямой импорт замкнул бы круг.
  const { tabs } = await import('./tabs.svelte');
  const norm = (path: string): string => path.replaceAll('/', '\\').toLowerCase();
  const wanted = norm(resolved.path);
  const open = tabs.items.find((tab) => tab.meta.path !== null && norm(tab.meta.path) === wanted);
  if (open?.editor) return open.editor.state.doc;
  const text = await noteText(resolved.path);
  return Text.of(text.split(/\r\n|\r|\n/));
}

/** Заголовки после `[[заметка#` (задача 148): список — как оглавление. */
async function searchHeadings(note: string, query: string, from: string, target: EditorView): Promise<void> {
  const mine = (generation += 1);
  const doc = await headingSource(note, from, target).catch(() => null);
  if (mine !== generation) return;

  suggest.mode = 'headings';
  suggest.items = [];
  suggest.headings = doc ? matchHeadings(outlineOf(doc), query) : [];
  suggest.selected = 0;
  suggest.open = suggest.headings.length > 0 && suggest.caret !== null;
}

async function search(query: string, from: string, embed: boolean): Promise<void> {
  const mine = (generation += 1);
  // `![[` — «вставить файл», и там нужны картинки; `[[` — «сослаться
  // на заметку», и снимки экрана в списке только мешают (Р-218).
  const found = await findNotes(query, from, embed, 20).catch(() => [] as FileHit[]);

  // Пока ходили в индекс, курсор мог уехать, вкладка — смениться, подсказка —
  // закрыться. Ответ на отменённый запрос выбрасываем молча.
  if (mine !== generation) return;

  suggest.mode = 'files';
  suggest.headings = [];
  suggest.items = found;
  // Выбор всегда на первой строке: список пересобран, и «второй пункт»
  // прошлого списка не имеет к новому никакого отношения.
  suggest.selected = 0;
  // Показывать пустую рамку незачем: подсказка — это подсказка, а не ответ
  // на вопрос. Не нашлось — её просто нет, и клавиши достаются редактору.
  suggest.open = found.length > 0 && suggest.caret !== null;
}

export function move(delta: number): void {
  const count = suggest.mode === 'headings' ? suggest.headings.length : suggest.items.length;
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
  if (suggest.mode === 'headings') return acceptHeading();

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

/**
 * Вставить выбранный заголовок (задача 148): вместо набранного после `#` —
 * текст заголовка в виде для ссылки, без знаков, которые закрыли бы её
 * раньше времени (`headingForLink`, правило Obsidian).
 */
function acceptHeading(): boolean {
  const item = suggest.headings[suggest.selected];
  const editor = view;
  const place = context;
  if (!item || !editor || !place) return false;

  close();

  const now = linkContextAt(editor.state);
  if (!now || now.from !== place.from || now.query !== place.query) return false;
  const edit = headingInsertion(now, headingForLink(item.text));
  if (!edit) return false;

  editor.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.cursor },
    scrollIntoView: true,
    userEvent: 'input.complete',
  });
  editor.focus();
  return true;
}
