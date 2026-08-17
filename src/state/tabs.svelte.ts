import { EditorState, type Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import * as ipc from '../ipc/files';
import type { Buffer, BufferWithText, ViewState } from '../ipc/files';
import { extensionsFor, languageCompartment } from '../editor/setup';
import { editorView } from '../editor/current';
import {
  languageById,
  languageForFile,
  type Language,
} from '../editor/langs';
// Взаимный импорт с persist: там только функции, и зовутся они в рантайме,
// поэтому порядок загрузки модулей роли не играет.
import { forgetDraft, noteEdit, noteStructureChange } from './persist.svelte';
import { restoreFromSession } from './roots.svelte';

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
  /**
   * Прокрутка редактора.
   *
   * Отдельным полем, потому что в `EditorState` её нет: положение прокрутки —
   * свойство представления, а не документа. Записывается редактором при
   * прокрутке и восстанавливается при возврате на вкладку.
   */
  scrollTop: number;
  /**
   * Язык подсветки, выбранный пользователем вручную.
   *
   * `null` — определять по имени файла. Хранится отдельно от `meta`, потому
   * что это свойство вкладки во фронтенде, а не сведения о буфере из ядра.
   */
  language: string | null;
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

/**
 * Буферы, поднятые из черновика после аварийного завершения.
 *
 * Для них исходного текста мы не знаем: на диске лежит одно, в черновике
 * другое, и сравнивать не с чем. Такой буфер считается изменённым до первого
 * сохранения — иначе, стерев в нём всё, пользователь получил бы «чистую»
 * вкладку и закрыл бы её без вопросов, потеряв восстановленное.
 */
const restoredDirty = new Set<number>();

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

/** То, что нужно сессии от вида: где курсор и куда прокручено. */
export function viewStateOf(tab: Tab): ViewState {
  return {
    id: tab.meta.id,
    cursor: tab.editor.selection.main.head,
    scrollTop: tab.scrollTop,
    language: tab.language,
  };
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
  const modified = restoredDirty.has(id) || (baseline ? !view.state.doc.eq(baseline) : false);

  if (modified !== tab.meta.modified) {
    tab.meta = { ...tab.meta, modified };
    void ipc.setModified(id, modified);
  }

  // Черновик уйдёт на диск через задержку — инвариант 4.
  noteEdit();
}

function makeState(meta: Buffer, text: string, cursor = 0): EditorState {
  return EditorState.create({
    doc: text,
    // Курсор за пределами документа уронил бы создание состояния: снимок мог
    // относиться к более длинному тексту, чем оказался на диске.
    selection: { anchor: Math.min(cursor, text.length) },
    extensions: extensionsFor(meta, (view) => onEditorUpdate(meta.id, view)),
  });
}

function put(
  meta: Buffer,
  text: string,
  cursor = 0,
  scrollTop = 0,
  language: string | null = null,
): void {
  const editor = makeState(meta, text, cursor);
  baselines.set(meta.id, editor.doc);

  const existing = tabById(meta.id);
  if (existing) {
    existing.meta = meta;
    existing.editor = editor;
    existing.scrollTop = scrollTop;
    existing.language = language;
  } else {
    tabs.items.push({ meta, editor, scrollTop, language });
  }
  tabs.activeId = meta.id;
  // Язык грузится и встаёт на место сам: ждать его открытие файла не должно.
  void applyLanguage(meta.id);
  noteStructureChange();
}

/**
 * Какой язык должен действовать на вкладке.
 *
 * Выбор пользователя главнее имени файла: он для того и сделан.
 */
export function languageOf(tab: Tab): Language | null {
  return tab.language !== null
    ? languageById(tab.language)
    : languageForFile(tab.meta.path ?? tab.meta.title);
}

/**
 * Загрузить язык и подставить его в состояние вкладки.
 *
 * Загрузка асинхронная, поэтому подстановка идёт через отсек: пересобирать
 * состояние целиком значило бы потерять историю отмены и положение курсора.
 */
async function applyLanguage(id: number): Promise<void> {
  const tab = tabById(id);
  if (!tab) return;

  // Свыше порога подсветки нет — это записанная политика больших файлов:
  // разбор десятков мегабайт съел бы и память, и отзывчивость.
  const language = tab.meta.large ? null : languageOf(tab);
  const support = language ? await language.load() : [];

  // За время загрузки вкладку могли закрыть или переключить язык ещё раз.
  const current = tabById(id);
  if (!current || languageOf(current)?.id !== language?.id) return;

  const effects = languageCompartment.reconfigure(support);
  const view = editorView();

  if (tabs.activeId === id && view) {
    // Вкладка на экране: правим живое представление, иначе оно осталось бы
    // со старым состоянием, а прокрутка отскочила бы к сохранённой.
    view.dispatch({ effects });
    current.editor = view.state;
  } else {
    current.editor = current.editor.update({ effects }).state;
  }
}

/** Выбрать язык подсветки вручную. `null` — снова определять по имени. */
export function setLanguage(id: number, language: string | null): void {
  const tab = tabById(id);
  if (!tab) return;

  tab.language = language;
  void applyLanguage(id);
  // Выбор — часть сессии: он не должен теряться при перезапуске.
  noteStructureChange();
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
    // Буфер сохранён — теперь есть с чем сравнивать, подпорка не нужна.
    restoredDirty.delete(id);
  }
}

export function setActive(id: number): void {
  tabs.activeId = id;
  noteStructureChange();
}

/** Переключение вкладок по кругу: за последней снова идёт первая. */
function step(delta: 1 | -1): void {
  if (tabs.items.length === 0) return;
  const index = tabs.items.findIndex((t) => t.meta.id === tabs.activeId);
  const from = index < 0 ? 0 : index;
  const next = (from + delta + tabs.items.length) % tabs.items.length;
  setActive(tabs.items[next]!.meta.id);
}

export const nextTab = (): void => step(1);
export const previousTab = (): void => step(-1);

/**
 * Восстановить вкладки из сессии.
 *
 * Содержимое приходит из ядра готовым: для изменённых буферов — из черновика,
 * для остальных — перечитанным с диска. Фронтенду остаётся расставить их
 * по местам, сохранив порядок, курсоры и прокрутку.
 */
export async function restore(): Promise<string[]> {
  const session = await ipc.restoreSession();

  for (const item of session.buffers) {
    const { text, cursor, scrollTop, language, ...meta } = item;
    const editor = makeState(meta, text, cursor);

    if (meta.modified) {
      restoredDirty.add(meta.id);
    }
    baselines.set(meta.id, editor.doc);
    tabs.items.push({ meta, editor, scrollTop, language: language ?? null });
    // Язык подтягивается в фоне: старт не должен ждать разбора парсеров.
    void applyLanguage(meta.id);
  }

  await restoreFromSession(
    session.roots,
    session.sidebar,
    session.sidebarWidth,
    session.sidebarPanel,
  );

  tabs.activeId = session.active ?? tabs.items.at(-1)?.meta.id ?? null;
  return session.notices;
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
  restoredDirty.delete(id);
  // Черновик закрытой вкладки больше не нужен: восстанавливать её не будем.
  await forgetDraft(id);

  if (tabs.activeId === id) {
    // Активной становится соседняя вкладка: та, что была справа, иначе слева.
    const next = tabs.items[index] ?? tabs.items[index - 1] ?? null;
    tabs.activeId = next ? next.meta.id : null;
  }

  noteStructureChange();
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
  noteStructureChange();
}
