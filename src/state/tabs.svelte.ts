import { EditorState, type Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import * as ipc from '../ipc/files';
import type { Buffer, BufferWithText } from '../ipc/files';
import { extensionsFor } from '../editor/setup';

/**
 * Вкладки и их содержимое.
 *
 * Разделение обязанностей по решению Р-002: ядро владеет путём, кодировкой,
 * переносами и состоянием файла на диске; фронтенд владеет содержимым — оно
 * и так живёт в CodeMirror, и вторая копия в Rust означала бы два источника
 * истины и постоянную задачу их согласования.
 *
 * Состояние редактора хранится по вкладке целиком: в `EditorState` входят
 * и текст, и курсоры, и прокрутка, и история отмены. Поэтому переключение
 * вкладок ничего из этого не теряет — и поэтому же оно ничего не стоит.
 */

export interface Tab {
  meta: Buffer;
  editor: EditorState;
}

/** Порядок в массиве — это порядок вкладок, такой же, как в ядре. */
export const tabs = $state<{ items: Tab[]; activeId: number | null }>({
  items: [],
  activeId: null,
});

/**
 * Текст, каким он был при открытии или последнем сохранении.
 *
 * С ним сравнивается текущий, чтобы понять, изменён ли буфер. Сравнение
 * с исходником, а не «была ли хоть одна правка», даёт правильное поведение
 * при отмене: откатив все изменения, пользователь получает чистый буфер,
 * а не вечную звёздочку на вкладке.
 *
 * `Map`, а не поле вкладки: это служебные данные, интерфейсу они не нужны,
 * и держать их в реактивном состоянии значило бы гонять лишние пересчёты.
 */
const baselines = new Map<number, Text>();

export function activeTab(): Tab | null {
  if (tabs.activeId === null) return null;
  return tabs.items.find((t) => t.meta.id === tabs.activeId) ?? null;
}

export function tabById(id: number): Tab | null {
  return tabs.items.find((t) => t.meta.id === id) ?? null;
}

/** Текст буфера во внутреннем виде — с переводами строк `\n`. */
export function textOf(tab: Tab): string {
  return tab.editor.doc.toString();
}

/**
 * Реакция на каждое изменение в редакторе.
 *
 * Состояние вкладки обновляется всегда, а ядру сообщается только о переходе
 * «чистый ↔ изменённый»: звать команду на каждое нажатие клавиши незачем.
 */
function onEditorUpdate(id: number, view: EditorView): void {
  const tab = tabById(id);
  if (!tab) return;

  tab.editor = view.state;

  const baseline = baselines.get(id);
  const modified = baseline ? !view.state.doc.eq(baseline) : false;

  if (modified !== tab.meta.modified) {
    tab.meta = { ...tab.meta, modified };
    void ipc.setModified(id, modified);
  }
}

function makeState(meta: Buffer, text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: extensionsFor(meta, (view) => onEditorUpdate(meta.id, view)),
  });
}

function put(meta: Buffer, text: string): void {
  const editor = makeState(meta, text);
  baselines.set(meta.id, editor.doc);

  const existing = tabById(meta.id);
  if (existing) {
    existing.meta = meta;
    existing.editor = editor;
  } else {
    tabs.items.push({ meta, editor });
  }
  tabs.activeId = meta.id;
}

/** Обновить сведения о буфере, не трогая содержимое. */
export function applyMeta(meta: Buffer): void {
  const tab = tabById(meta.id);
  if (tab) {
    tab.meta = meta;
  }
}

/** Считать текущий текст исходным: буфер стал чистым. */
export function resetBaseline(id: number): void {
  const tab = tabById(id);
  if (tab) {
    baselines.set(id, tab.editor.doc);
  }
}

export function setActive(id: number): void {
  tabs.activeId = id;
}

export async function createEmpty(): Promise<void> {
  const meta = await ipc.newBuffer();
  put(meta, '');
}

export async function openPath(path: string): Promise<void> {
  // Если файл уже открыт, ядро вернёт тот же буфер, и `put` заменит
  // содержимое существующей вкладки вместо создания второй.
  const opened = await ipc.openFile(path);
  put(opened, opened.text);
}

/** Заменить содержимое вкладки прочитанным заново. */
export function replaceContent(opened: BufferWithText): void {
  put(opened, opened.text);
}

export async function close(id: number): Promise<void> {
  const index = tabs.items.findIndex((t) => t.meta.id === id);
  if (index < 0) return;

  await ipc.closeBuffer(id);
  tabs.items.splice(index, 1);
  baselines.delete(id);

  if (tabs.activeId !== id) return;

  // Активной становится соседняя вкладка: та, что была справа, иначе слева.
  const next = tabs.items[index] ?? tabs.items[index - 1] ?? null;
  tabs.activeId = next ? next.meta.id : null;
}

/**
 * Переставить вкладку только на стороне интерфейса.
 *
 * Во время перетаскивания порядок меняется много раз в секунду, и звать
 * на каждый шаг команду ядра незачем. Итог отправляется один раз, когда
 * пользователь отпустил вкладку, — см. `commitOrder`.
 */
export function moveLocal(id: number, to: number): number {
  const from = tabs.items.findIndex((t) => t.meta.id === id);
  if (from < 0) return -1;

  const target = Math.max(0, Math.min(to, tabs.items.length - 1));
  if (from === target) return target;

  const [tab] = tabs.items.splice(from, 1);
  if (tab) {
    tabs.items.splice(target, 0, tab);
  }
  return target;
}

/** Сообщить ядру итоговое место вкладки: порядок — часть сессии. */
export async function commitOrder(id: number): Promise<void> {
  const index = tabs.items.findIndex((t) => t.meta.id === id);
  if (index < 0) return;
  await ipc.reorderBuffer(id, index);
}
