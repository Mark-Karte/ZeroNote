import { EditorState, type Text } from '@codemirror/state';
import * as ipc from '../ipc/files';
import type { Buffer, BufferWithText, ViewState } from '../ipc/files';
import { EditorView } from '@codemirror/view';
import {
  autoCloseCompartment,
  autoCloseExtension,
  extensionsFor,
  indentCompartment,
  indentExtension,
  invisiblesCompartment,
  invisiblesExtension,
  languageCompartment,
  wrapCompartment,
} from '../editor/setup';
import { resolveIndent, type Indent } from '../editor/indent';
import { bookmarkLines } from '../editor/bookmarks';
import { editorView } from '../editor/current';
import {
  languageById,
  languageForFile,
  type Language,
} from '../editor/langs';
// Взаимный импорт с persist: там только функции, и зовутся они в рантайме,
// поэтому порядок загрузки модулей роли не играет.
import { forgetDraft, noteEdit, noteStructureChange } from './persist.svelte';
import {
  autoCloseEnabled,
  indentSettings,
  invisiblesEnabled,
  wrapEnabled,
} from './settings.svelte';
import { restoreFromSession } from './roots.svelte';
import { scheduleAutosave } from './autosave.svelte';
// Подсказка про вкладки ничего не знает — всё, что ей нужно, приходит
// аргументами. Поэтому обычный импорт, а не отложенный: круга здесь нет.
import { reportContext } from './suggest.svelte';

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
  /**
   * Чем набирается отступ в этом файле.
   *
   * Свойство вкладки, а не приложения: определяется по содержимому файла
   * (Р-106). У настройки роль умолчания — для файлов, где отступов нет.
   */
  indent: Indent;
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
    // Номера строк, а не позиции: файл могли поправить в другой программе,
    // пока приложение было закрыто, и номер переживает такую правку лучше.
    bookmarks: bookmarkLines(tab.editor),
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
  // А если включено автосохранение, то через ту же паузу и сам файл (Р-141).
  scheduleAutosave();
}

/**
 * Закладки переключили.
 *
 * Ни текст, ни выделение при этом не менялись, поэтому обычный обработчик
 * правки сюда не заходит. Черновик писать незачем — содержимое то же;
 * а вот снимок сессии обновить надо, иначе закладки не переживут перезапуск.
 */
function onBookmarksChanged(id: number, view: EditorView): void {
  const tab = tabById(id);
  if (!tab) return;

  tab.editor = view.state;
  noteStructureChange();
}

function makeState(
  meta: Buffer,
  text: string,
  cursor = 0,
  indent?: Indent,
  bookmarks: number[] = [],
): EditorState {
  return EditorState.create({
    doc: text,
    // Курсор за пределами документа уронил бы создание состояния: снимок мог
    // относиться к более длинному тексту, чем оказался на диске.
    selection: { anchor: Math.min(cursor, text.length) },
    extensions: extensionsFor(meta, {
      onChange: (view) => onEditorUpdate(meta.id, view),
      onBookmarks: (view) => onBookmarksChanged(meta.id, view),
      // Переход по ссылке живёт в `state/links`: редактор не должен знать
      // про вкладки и панели. Импорт по требованию — иначе получится круг.
      onFollow: (target) => void import('./links.svelte').then((m) => m.follow(target)),
      // Подсказка имён при `[[` (Р-132). Язык и путь берутся у вкладки здесь,
      // а не внутри подсказки: язык меняют руками в строке состояния,
      // а путь — «сохранить как», и обе перемены должны действовать сразу.
      onLinkContext: (context, view) => {
        const tab = tabById(meta.id);
        reportContext({
          context,
          path: tab?.meta.path ?? null,
          markdown: tab ? languageOf(tab)?.id === 'markdown' : false,
          view,
        });
      },
      // Путь берётся каждый раз заново: «сохранить как» его меняет, а вместе
      // с ним меняется и то, куда ведут ссылки из этого файла.
      sourcePath: () => tabById(meta.id)?.meta.path ?? null,
      wrap: wrapEnabled(),
      autoClose: autoCloseEnabled(),
      indent: indent ?? resolveIndent(text, indentSettings()),
      invisibles: invisiblesEnabled(),
      bookmarks,
    }),
  });
}

/**
 * Применить перенос строк ко всем вкладкам.
 *
 * Через отсек и обычную транзакцию, а не пересозданием состояния: пересоздание
 * стёрло бы историю отмены во всех открытых файлах разом. Проходим по всем
 * вкладкам, а не только по активной, — иначе переключение вкладки возвращало бы
 * прежний перенос.
 */
export function applyWrap(wrap: boolean): void {
  const extension = wrap ? EditorView.lineWrapping : [];
  for (const tab of tabs.items) {
    tab.editor = tab.editor.update({
      effects: wrapCompartment.reconfigure(extension),
    }).state;
  }
}

/**
 * Применить настройку отступа к тем вкладкам, которые её слушают.
 *
 * Только к ним: у файла, где отступ определён по содержимому, настройка
 * ничего не меняет — иначе правка конфига переписывала бы поведение в чужих
 * файлах, ради чего Р-106 и написан. Выбранное вручную тоже остаётся.
 */
export function applyIndentSettings(fallback: { style: Indent['style']; width: number }): void {
  for (const tab of tabs.items) {
    if (tab.indent.source !== 'settings') continue;
    setIndentOf(tab, { ...fallback, source: 'settings' });
  }
}

/** Сменить отступ вкладки вручную — из строки состояния. */
export function setIndent(id: number, indent: Omit<Indent, 'source'>): void {
  const tab = tabById(id);
  if (tab) setIndentOf(tab, { ...indent, source: 'manual' });
}

function setIndentOf(tab: Tab, indent: Indent): void {
  tab.indent = indent;
  tab.editor = tab.editor.update({
    effects: indentCompartment.reconfigure(indentExtension(indent)),
  }).state;
}

/** То же самое для невидимых символов. */
export function applyInvisibles(show: boolean): void {
  const extension = invisiblesExtension(show);
  for (const tab of tabs.items) {
    tab.editor = tab.editor.update({
      effects: invisiblesCompartment.reconfigure(extension),
    }).state;
  }
}

/** То же самое для автозакрытия скобок и по тем же причинам. */
export function applyAutoClose(autoClose: boolean): void {
  const extension = autoCloseExtension(autoClose);
  for (const tab of tabs.items) {
    tab.editor = tab.editor.update({
      effects: autoCloseCompartment.reconfigure(extension),
    }).state;
  }
}

function put(
  meta: Buffer,
  text: string,
  cursor = 0,
  scrollTop = 0,
  language: string | null = null,
): void {
  // Отступ определяется один раз, по содержимому: перечитывать его на каждой
  // правке значило бы менять поведение `Tab` посреди набора.
  const indent = resolveIndent(text, indentSettings());
  const editor = makeState(meta, text, cursor, indent);
  baselines.set(meta.id, editor.doc);

  const existing = tabById(meta.id);
  if (existing) {
    existing.meta = meta;
    existing.editor = editor;
    existing.scrollTop = scrollTop;
    existing.language = language;
    existing.indent = indent;
  } else {
    tabs.items.push({ meta, editor, scrollTop, language, indent });
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

  // Условие сильнее, чем «вкладка активна»: в представлении должно лежать
  // именно её состояние.
  //
  // Проверять приходится потому, что сюда попадают и синхронно. У буфера
  // без языка — новый файл, `.txt`, незнакомое расширение — ветка `support`
  // не содержит `await` вовсе, и вся функция выполняется прямо внутри `put`,
  // когда представление ещё показывает прошлую вкладку. Без проверки строка
  // ниже присваивала новой вкладке чужое состояние, и её содержимое пропадало
  // ещё до первой отрисовки. Нашлось переделкой стенда на настоящую вкладку
  // (задача 30): вкладка с документом в мегабайт оказывалась пустой.
  if (tabs.activeId === id && view && view.state === current.editor) {
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

let markRestored: () => void = () => {};

/**
 * Сигнал «сессия восстановлена».
 *
 * Нужен измерительному стенду: он открывает свою вкладку с документом
 * в мегабайт и обязан дождаться конца восстановления. `restore` заменяет
 * список вкладок целиком, и вкладка, созданная раньше, исчезает вместе
 * с документом — стенд на этом и споткнулся, показав пустой буфер вместо
 * своего. Обычному интерфейсу сигнал не нужен: он и так рисуется от списка.
 */
export const sessionRestored: Promise<void> = new Promise((resolve) => {
  markRestored = resolve;
});

/**
 * Восстановить вкладки из сессии.
 *
 * Содержимое приходит из ядра готовым: для изменённых буферов — из черновика,
 * для остальных — перечитанным с диска. Фронтенду остаётся расставить их
 * по местам, сохранив порядок, курсоры и прокрутку.
 */
export async function restore(): Promise<string[]> {
  try {
    return await restoreInner();
  } finally {
    // Через finally: сорвавшееся восстановление тоже завершает ожидание,
    // иначе стенд ждал бы сигнала, которого уже не будет.
    markRestored();
  }
}

async function restoreInner(): Promise<string[]> {
  const session = await ipc.restoreSession();

  // Восстановление рассчитано на пустой список и за запуск случается один раз.
  // Очистка нужна не приложению, а отладке: при горячей замене модулей
  // компонент монтируется заново, вкладки удваивались бы, и Svelte падал бы
  // на повторяющемся ключе — с сообщением, из которого настоящую причину
  // не видно вовсе.
  tabs.items = [];

  for (const item of session.buffers) {
    const { text, cursor, scrollTop, language, bookmarks, ...meta } = item;
    const indent = resolveIndent(text, indentSettings());
    const editor = makeState(meta, text, cursor, indent, bookmarks ?? []);

    if (meta.modified) {
      restoredDirty.add(meta.id);
    }
    baselines.set(meta.id, editor.doc);
    tabs.items.push({ meta, editor, scrollTop, language: language ?? null, indent });
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

export async function createEmpty(text = ''): Promise<void> {
  const meta = await ipc.newBuffer();
  put(meta, text);

  // Непустая вкладка изменена с рождения: содержимое есть только в памяти,
  // и потерять его при закрытии нельзя (инвариант 4).
  if (text !== '') {
    restoredDirty.add(meta.id);
    tabById(meta.id)!.meta = { ...meta, modified: true };
    void ipc.setModified(meta.id, true);
    noteEdit();
  }
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
