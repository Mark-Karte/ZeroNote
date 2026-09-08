import {
  EditorState,
  Transaction,
  type StateEffect,
  type Text,
  type TransactionSpec,
} from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import * as ipc from '../ipc/files';
import type { Buffer, BufferWithText, PaneView, ViewState } from '../ipc/files';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { createMirror, replaySpec, sourceOf } from '../editor/mirror';
import {
  type EditorOptions,
  autoCloseCompartment,
  autoCloseExtension,
  extensionsFor,
  indentCompartment,
  indentExtension,
  invisiblesCompartment,
  invisiblesExtension,
  lineNumbersCompartment,
  lineNumbersExtension,
  livePreviewCompartment,
  livePreviewExtension,
  languageCompartment,
  wrapCompartment,
} from '../editor/setup';
import { resolveIndent, type Indent } from '../editor/indent';
import type { Scale } from '../ui/zoom';
import { wrapFor } from '../editor/readable';
import { livePreviewOn } from '../editor/live-preview';
import { lineNumbersOn } from '../editor/line-numbers';
import { JUMP_LINES, jumped } from './history.svelte';
import { bookmarkLines } from '../editor/bookmarks';
import { editorView, editorViewOf } from '../editor/current';
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
  livePreviewEnabled,
  wrapEnabled,
  readableWidthEnabled,
  lineNumbersSetting,
} from './settings.svelte';
import { restoreFromSession } from './roots.svelte';
import { scheduleAutosave } from './autosave.svelte';
import {
  activePane,
  activeTabId,
  applyLayout,
  layout,
  moveTab,
  moveToSplit,
  openLocal,
  paneById,
  panes,
  paneShowing,
  registerLayoutListener,
  setActivePane,
  setActiveTab,
} from './panes.svelte';
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

/**
 * Редактор вкладки — всё, что есть только у текста.
 *
 * Отдельным объектом, а не полями рядом с `meta`: у вкладки, которая
 * не текст, ничего этого нет — ни состояния редактора, ни языка, ни отступа.
 * Проверка `tab.editor !== null` и есть проверка «это текст», и она же
 * заставляет вспомнить о прочих видах в каждом месте, где текст нужен.
 */
export interface TabEditor {
  state: EditorState;
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
  /**
   * Область, где показано главное состояние (Р-209). `null` — ещё нигде:
   * первая область, которой достанется вкладка, заберёт его себе.
   */
  home: number | null;
  /**
   * Зеркала по областям: тот же текст, свои курсоры и прокрутка,
   * история пуста. Обычный объект, а не `Map`: он живёт внутри руны,
   * и замена состояния зеркала должна быть видна хосту той области.
   */
  mirrors: Record<number, MirrorState>;
  /**
   * Курсоры из сессии, ещё не применённые (задача 84).
   *
   * Зеркало создаётся лениво — в тот миг, когда область впервые рисует
   * вкладку, — а сессия восстанавливается раньше и вся сразу. Значит
   * курсоры надо где-то подождать; здесь они и ждут, и запись убирается,
   * как только досталась своему представлению.
   */
  restored: Record<number, { cursor: number; scrollTop: number }>;
}

/** Состояние одной области у вкладки: главное или зеркало. */
export interface MirrorState {
  state: EditorState;
  scrollTop: number;
}

/**
 * Состояние показа картинки — только у вкладки с картинкой.
 *
 * Байты здесь появляются, когда вкладка на экране, и исчезают, когда она
 * с экрана уходит (Р-193): десять вкладок с картинками не должны означать
 * десять картинок в памяти окна.
 */
export interface ImageState {
  /**
   * Адрес `data:`. `null` — байты ещё не спрошены или вкладки нет на экране.
   */
  source: string | null;
  /** Почему показать нечего. `null` — всё в порядке. */
  problem: string | null;
  /** Настоящий размер в точках. Ноль — картинку ещё не разобрали. */
  width: number;
  height: number;
  /** Масштаб показа. Переживает переключение вкладок — он свойство вкладки. */
  scale: Scale;
}

/**
 * Состояние показа PDF — только у вкладки с PDF.
 *
 * Байтов здесь нет намеренно: у документа их держит pdf.js, пока вкладка
 * на экране, и отпускает вместе с ней (Р-193). Здесь остаётся то, что должно
 * пережить уход на соседнюю вкладку и возврат: страница и масштаб.
 */
export interface PdfState {
  /** Сколько всего страниц. Ноль — документ ещё не разобран. */
  pages: number;
  /** Какая страница перед глазами, с единицы. */
  page: number;
  /** Масштаб. `fit` — по ширине окна: у страницы важна ширина, а не высота. */
  scale: Scale;
  /** Почему показать нечего. `null` — всё в порядке. */
  problem: string | null;
}

export interface Tab {
  /** Сведения из ядра, включая вид вкладки (Р-180). */
  meta: Buffer;
  /** `null` у вкладки, которая не текст: параметры, картинка, PDF. */
  editor: TabEditor | null;
  /** `null` у вкладок всех прочих видов. */
  image: ImageState | null;
  /** `null` у вкладок всех прочих видов. */
  pdf: PdfState | null;
}

/** Свежее состояние показа: вписать в окно, байтов ещё нет. */
export function freshImage(): ImageState {
  return { source: null, problem: null, width: 0, height: 0, scale: 'fit' };
}

/** Свежее состояние показа PDF: первая страница, по ширине окна. */
export function freshPdf(): PdfState {
  return { pages: 0, page: 1, scale: 'fit', problem: null };
}

/**
 * Реестр открытых вкладок.
 *
 * Порядок здесь ничего не значит: с этапа 11 порядок вкладок и активная
 * вкладка живут в раскладке (`state/panes`, Р-207) — у каждой области свои,
 * и один буфер может стоять в нескольких. Здесь только «что открыто».
 */
export const tabs = $state<{ items: Tab[] }>({
  items: [],
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

/** Активная вкладка окна — активная вкладка активной области (Р-210). */
export function activeTab(): Tab | null {
  const id = activeTabId();
  if (id === null) return null;
  return tabs.items.find((t) => t.meta.id === id) ?? null;
}

export function tabById(id: number): Tab | null {
  return tabs.items.find((t) => t.meta.id === id) ?? null;
}

/**
 * Текст буфера во внутреннем виде — с переводами строк `\n`.
 *
 * Принимает редактор, а не вкладку: у вкладки, которая не текст, содержимого
 * нет вовсе, и возвращать за неё пустую строку значило бы дать сохранению
 * повод записать пустой файл.
 */
export function contentOf(editor: TabEditor): string {
  return editor.state.doc.toString();
}

/** То, что нужно сессии от вида: где курсор и куда прокручено. */
export function viewStateOf(tab: Tab): ViewState {
  const editor = tab.editor;

  // У вкладки, которая не текст, курсора и закладок нет: в снимок уезжает
  // один её вид, и ядро по нему поднимает её обратно.
  return {
    id: tab.meta.id,
    cursor: editor ? editor.state.selection.main.head : 0,
    scrollTop: editor?.scrollTop ?? 0,
    language: editor?.language ?? null,
    // Номера строк, а не позиции: файл могли поправить в другой программе,
    // пока приложение было закрыто, и номер переживает такую правку лучше.
    bookmarks: editor ? bookmarkLines(editor.state) : [],
  };
}

/**
 * Реакция на каждое изменение в главном состоянии вкладки.
 *
 * Состояние вкладки обновляется всегда, а ядру сообщается только о переходе
 * «чистый ↔ изменённый»: звать команду на каждое нажатие клавиши незачем.
 * Изменения текста уезжают в зеркала (Р-209) — во все, кроме того, откуда
 * они пришли.
 */
function onEditorUpdate(id: number, update: ViewUpdate): void {
  const tab = tabById(id);
  if (!tab?.editor) return;

  noteJump(id, tab.editor.home, update);
  tab.editor.state = update.state;
  afterPrimaryChange(tab);
  fanOut(tab, update.transactions);
}

/**
 * Дальний прыжок курсора — это место, куда вернёт «назад» (задача 85).
 *
 * Здесь, в слушателе обновлений, а не в десятке команд: переход к строке,
 * закладка, оглавление, результат поиска и щелчок мышью в другой конец файла
 * приходят сюда одинаково — транзакцией со сменой выделения. Одно место
 * вместо десяти точек входа, которые пришлось бы держать в согласии.
 *
 * Правка не считается прыжком, даже длинная: человек её сделал сам и знает,
 * где он. Считается только перемещение по готовому тексту.
 */
function noteJump(id: number, pane: number | null, update: ViewUpdate): void {
  if (pane === null || !update.selectionSet || update.docChanged) return;

  // **Документ обязан быть тем же.** Переключение вкладки подменяет
  // состояние в том же представлении, и слушатель видит это как смену
  // выделения без правки — то есть как прыжок. Строки при этом считаются
  // в двух разных документах, и «прыжок» выходил почти всегда: он стирал
  // путь вперёд, и «вперёд» переставало работать сразу после «назад».
  // Найдено на живом окне; тестом не ловится — в нём нет представления.
  if (update.startState.doc !== update.state.doc) return;

  const before = update.startState;
  const from = before.doc.lineAt(before.selection.main.head).number;
  const to = update.state.doc.lineAt(update.state.selection.main.head).number;
  if (Math.abs(to - from) < JUMP_LINES) return;

  jumped(
    { tab: id, pane, pos: before.selection.main.head },
    { tab: id, pane, pos: update.state.selection.main.head },
  );
}

/** Что делается после любой правки главного состояния — из окна или без него. */
function afterPrimaryChange(tab: Tab): void {
  const editor = tab.editor;
  if (!editor) return;
  const id = tab.meta.id;

  const baseline = baselines.get(id);
  const modified = restoredDirty.has(id) || (baseline ? !editor.state.doc.eq(baseline) : false);

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
 * Разослать правки главного состояния зеркалам.
 *
 * Источник — область, из которой транзакция пришла; ей же обратно
 * не шлётся. Прямой ввод в главное источника не имеет, и тогда получают все.
 */
function fanOut(tab: Tab, transactions: readonly Transaction[]): void {
  const editor = tab.editor;
  if (!editor) return;

  for (const tr of transactions) {
    const from = sourceOf(tr);
    const spec = replaySpec(tr, from ?? editor.home ?? 0);
    if (!spec) continue;

    for (const key of Object.keys(editor.mirrors)) {
      const pane = Number(key);
      if (pane !== from) applyToSlot(tab, pane, spec);
    }
  }
}

/**
 * Правка в зеркале: уезжает в главное, а уж оно рассылает остальным.
 *
 * Черновик, признак изменения и автосохранение здесь не трогаются: всё это
 * случится в главном, когда правка туда доедет, — а доедет она сразу же,
 * синхронно.
 */
function onMirrorUpdate(id: number, pane: number, update: ViewUpdate): void {
  const tab = tabById(id);
  const mirror = tab?.editor?.mirrors[pane];
  if (!tab || !mirror) return;

  noteJump(id, pane, update);
  mirror.state = update.state;

  for (const tr of update.transactions) {
    // Рассылка сюда и пришла — дальше не идёт, иначе правка ходила бы по кругу.
    if (sourceOf(tr) !== null) continue;
    const spec = replaySpec(tr, pane);
    if (spec) applyToPrimary(tab, spec);
  }
}

/**
 * Применить транзакцию к состоянию, которое область показывает у вкладки.
 *
 * Если оно сейчас в представлении — через него, чтобы слушатель записал
 * итог и прокрутка не отскочила; иначе прямо в запас. Это то же условие,
 * что в Р-105: «в представлении лежит именно это состояние», и другого
 * признака «на экране» нет.
 *
 * Зеркало, к которому правка не подошла, выбрасывается: его пересоздадут
 * из главного при следующем показе. Такое означало бы, что тексты
 * разошлись, а расхождение между состояниями одного буфера — дефект,
 * и молча жить с ним нельзя.
 */
function applyToSlot(tab: Tab, pane: number, spec: TransactionSpec): void {
  const editor = tab.editor;
  if (!editor) return;
  const slot = editor.home === pane ? editor : editor.mirrors[pane];
  if (!slot) return;

  const view = editorViewOf(pane);
  if (view && view.state === slot.state) {
    view.dispatch(spec);
    // Переконфигурация отсека не меняет ни текста, ни выделения,
    // и слушатель её не видит — итог записывается здесь.
    slot.state = view.state;
    return;
  }

  try {
    slot.state = slot.state.update(spec).state;
  } catch {
    if (slot !== editor) delete editor.mirrors[pane];
  }
}

/**
 * Применить транзакцию к главному состоянию — откуда бы она ни пришла.
 *
 * Главное не обязано быть на экране: его область может показывать другую
 * вкладку. Тогда правка считается на запасе, и всё, что сделал бы
 * слушатель окна, делается здесь руками.
 */
function applyToPrimary(tab: Tab, spec: TransactionSpec | Transaction): void {
  const editor = tab.editor;
  if (!editor) return;

  const view = editor.home === null ? null : editorViewOf(editor.home);
  if (view && view.state === editor.state) {
    if (spec instanceof Transaction) {
      view.dispatch(spec);
    } else {
      view.dispatch(spec);
    }
    return;
  }

  const tr = spec instanceof Transaction ? spec : editor.state.update(spec);
  editor.state = tr.state;
  afterPrimaryChange(tab);
  fanOut(tab, [tr]);
}

/**
 * Состояние, которое область показывает у этой вкладки: главное или зеркало.
 *
 * Главное достаётся первой области, которая его спросила, и остаётся за ней,
 * пока она показывает вкладку. Остальным — зеркало, создаваемое здесь же
 * при первом обращении.
 */
export function slotFor(tab: Tab, pane: number): MirrorState | null {
  const editor = tab.editor;
  if (!editor) return null;

  if (editor.home === null || editor.home === pane) {
    const first = editor.home === null;
    editor.home = pane;
    // Главное тоже получает свой курсор из сессии, и только при первом
    // обращении: какая область станет главной после перезапуска, заранее
    // не известно, а курсоры записаны по областям (задача 84).
    if (first) applyRestored(editor, pane, editor);
    return editor;
  }

  let mirror = editor.mirrors[pane];
  if (!mirror) {
    mirror = { state: makeMirror(tab, editor, pane), scrollTop: editor.scrollTop };
    editor.mirrors[pane] = mirror;
    applyRestored(editor, pane, mirror);
  }
  return mirror;
}

/**
 * Поставить представлению курсор, дождавшийся его в сессии.
 *
 * Запись убирается сразу: она одноразовая, и второй раз возвращать курсор
 * туда, откуда человек уже ушёл, было бы хуже, чем не возвращать вовсе.
 */
function applyRestored(editor: TabEditor, pane: number, slot: MirrorState): void {
  const saved = editor.restored[pane];
  if (!saved) return;
  delete editor.restored[pane];

  slot.scrollTop = saved.scrollTop;
  slot.state = slot.state.update({
    // Курсор за концом документа уронил бы правку: файл могли укоротить
    // в другой программе, пока приложение было закрыто.
    selection: { anchor: Math.min(saved.cursor, slot.state.doc.length) },
  }).state;
}

/**
 * Курсоры всех представлений — для снимка сессии (задача 84).
 *
 * По областям, а не по вкладкам: один файл в двух областях — это два
 * курсора, и в снимке буфера помещается только один. Область, которую
 * ни разу не рисовали, своего представления не имеет — за неё в снимок
 * уезжает то, что она не успела получить из прошлой сессии.
 */
export function paneViewsOf(): PaneView[] {
  const out: PaneView[] = [];

  for (const pane of panes()) {
    for (const id of pane.tabs) {
      const editor = tabById(id)?.editor;
      if (!editor) continue;

      const slot = editor.home === pane.id ? editor : editor.mirrors[pane.id];
      if (slot) {
        out.push({
          pane: pane.id,
          buffer: id,
          cursor: slot.state.selection.main.head,
          scrollTop: slot.scrollTop,
        });
        continue;
      }

      const waiting = editor.restored[pane.id];
      if (waiting) {
        out.push({ pane: pane.id, buffer: id, ...waiting });
      }
    }
  }

  return out;
}

/** Отсеки, которые переконфигурируются на лету и потому копируются в зеркало. */
const COMPARTMENTS = [
  languageCompartment,
  wrapCompartment,
  indentCompartment,
  invisiblesCompartment,
  livePreviewCompartment,
  lineNumbersCompartment,
  autoCloseCompartment,
];

/**
 * Зеркало из главного: те же расширения, те же отсеки.
 *
 * Отсеки копируются из главного состояния, а не пересчитываются: язык мог
 * приехать асинхронно или быть выбран руками, и вычислять его заново
 * значило бы держать два пути к одному ответу.
 */
function makeMirror(tab: Tab, editor: TabEditor, pane: number): EditorState {
  const primary = editor.state;
  const extensions = extensionsFor(
    tab.meta,
    optionsFor(tab.meta, pane, editor.indent, bookmarkLines(primary)),
  );
  const fresh = createMirror(primary, extensions);
  const effects = COMPARTMENTS.map((compartment) =>
    compartment.reconfigure(compartment.get(primary) ?? []),
  );
  return fresh.update({ effects }).state;
}

/**
 * Раскладка изменилась: убрать зеркала без области, передать главное.
 *
 * Главное состояние, чья область больше не показывает вкладку, переезжает
 * в первое из оставшихся зеркал: новое главное — прежнее с выделением
 * зеркала, история и закладки целы (Р-209). Историю пересадить нельзя,
 * поэтому не пересаживается ничего.
 */
function reconcileMirrors(): void {
  for (const tab of tabs.items) {
    const editor = tab.editor;
    if (!editor) continue;
    const id = tab.meta.id;
    const shows = (pane: number): boolean => paneById(pane)?.tabs.includes(id) ?? false;

    for (const key of Object.keys(editor.mirrors)) {
      const pane = Number(key);
      if (!shows(pane)) delete editor.mirrors[pane];
    }

    if (editor.home !== null && !shows(editor.home)) {
      const heir = Object.keys(editor.mirrors).map(Number)[0];
      if (heir === undefined) {
        editor.home = null;
        continue;
      }
      const mirror = editor.mirrors[heir]!;
      editor.state = editor.state.update({ selection: mirror.state.selection }).state;
      editor.scrollTop = mirror.scrollTop;
      editor.home = heir;
      delete editor.mirrors[heir];
    }
  }
}

/**
 * Переконфигурировать отсек у всех состояний вкладки — главного и зеркал.
 *
 * Через отсек и обычную транзакцию, а не пересозданием состояния:
 * пересоздание стёрло бы историю отмены. Состояние на экране получает
 * транзакцию через представление, запасное — напрямую.
 */
function reconfigure(tab: Tab, effects: StateEffect<unknown> | StateEffect<unknown>[]): void {
  const editor = tab.editor;
  if (!editor) return;

  const spec = { effects };
  if (editor.home !== null) {
    applyToSlot(tab, editor.home, spec);
  } else {
    editor.state = editor.state.update(spec).state;
  }
  for (const key of Object.keys(editor.mirrors)) {
    applyToSlot(tab, Number(key), spec);
  }
}

/**
 * Отмена и возврат — всегда в главном состоянии (Р-209).
 *
 * В области с главным — обычная команда над представлением. В области
 * с зеркалом история пуста, и команда считается на главном, где бы оно
 * ни было; итог доезжает до зеркала как обычная правка.
 */
function runHistory(
  command: (target: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean,
): void {
  const tab = activeTab();
  const editor = tab?.editor;
  const view = editorView();
  if (!tab || !editor || !view) return;

  if (editor.home === layout.activePane) {
    command(view);
    return;
  }
  command({ state: editor.state, dispatch: (tr) => applyToPrimary(tab, tr) });
}

export const undoActive = (): void => runHistory(undo);
export const redoActive = (): void => runHistory(redo);

/**
 * Состояние, которое видно в активной области у этой вкладки: зеркало,
 * если там зеркало, иначе главное. Строка состояния и оглавление смотрят
 * сюда, а не в главное: курсор в зеркале свой, и показывать чужой значило
 * бы врать про строку и столбец.
 */
export function visibleState(tab: Tab): EditorState | null {
  const editor = tab.editor;
  if (!editor) return null;
  const pane = layout.activePane;
  if (editor.home === pane) return editor.state;
  return editor.mirrors[pane]?.state ?? editor.state;
}

/** Область по номеру в порядке обхода (Р-210): `Ctrl+1…9`. Фокус — в её редактор. */
export function focusPane(index: number): void {
  const pane = panes()[index - 1];
  if (!pane) return;
  setActivePane(pane.id);
  editorViewOf(pane.id)?.focus();
}

/**
 * Перенести активную вкладку в соседнюю область — как `Ctrl+Alt+→` в VS Code.
 * Соседней нет — новая область с краю; единственную вкладку области так
 * не двигают: вышло бы то же окно (правило `move_to_split`).
 */
export function moveActiveTab(delta: 1 | -1): void {
  const pane = activePane();
  const id = pane.active;
  if (id === null) return;

  const order = panes();
  const index = order.findIndex((item) => item.id === pane.id);
  const neighbour = order[index + delta];
  if (neighbour) {
    void moveTab(id, pane.id, neighbour.id, null);
    return;
  }
  void moveToSplit(id, pane.id, pane.id, 'row', delta < 0);
}

/**
 * Закладки переключили.
 *
 * Ни текст, ни выделение при этом не менялись, поэтому обычный обработчик
 * правки сюда не заходит. Черновик писать незачем — содержимое то же;
 * а вот снимок сессии обновить надо, иначе закладки не переживут перезапуск.
 * Зеркалам закладка уезжает как эффект: она свойство буфера (Р-116).
 */
function onBookmarksChanged(id: number, update: ViewUpdate): void {
  const tab = tabById(id);
  if (!tab?.editor) return;

  tab.editor.state = update.state;
  noteStructureChange();
  fanOut(tab, update.transactions);
}

/**
 * Настройки расширений для вкладки — одни и для главного состояния,
 * и для зеркала. Различаются только слушатели: зеркало сообщает о правке
 * своей области, главное — о своей.
 */
function optionsFor(
  meta: Buffer,
  forPane: number | null,
  indent: Indent,
  bookmarks: number[],
): EditorOptions {
  // Язык здесь берётся из имени файла: при создании состояния другого
  // ещё нет, а выбранный руками доедет отсеком.
  const markdown = languageForFile(meta.path ?? meta.title)?.id === 'markdown';

  return {
    onChange: (update) =>
      forPane === null
        ? onEditorUpdate(meta.id, update)
        : onMirrorUpdate(meta.id, forPane, update),
    onBookmarks: (update) =>
      forPane === null
        ? onBookmarksChanged(meta.id, update)
        : onMirrorUpdate(meta.id, forPane, update),
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
    // Перенос считается по вкладке, а не по одной настройке: у markdown
    // его включает читаемая ширина (Р-156).
    wrap: wrapFor({
      wrap: wrapEnabled(),
      readableWidth: readableWidthEnabled(),
      markdown,
    }),
    autoClose: autoCloseEnabled(),
    indent,
    invisibles: invisiblesEnabled(),
    livePreview: livePreviewOn({ livePreview: livePreviewEnabled(), markdown }),
    lineNumbers: lineNumbersOn({ setting: lineNumbersSetting(), markdown }),
    bookmarks,
  };
}

function makeState(
  meta: Buffer,
  text: string,
  cursor = 0,
  indent?: Indent,
  bookmarks: number[] = [],
): EditorState {
  const resolved = indent ?? resolveIndent(text, indentSettings());
  return EditorState.create({
    doc: text,
    // Курсор за пределами документа уронил бы создание состояния: снимок мог
    // относиться к более длинному тексту, чем оказался на диске.
    selection: { anchor: Math.min(cursor, text.length) },
    extensions: extensionsFor(meta, optionsFor(meta, null, resolved, bookmarks)),
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
export function applyWrap(): void {
  for (const tab of tabs.items) {
    if (!tab.editor) continue;
    const extension = wrapOf(tab) ? EditorView.lineWrapping : [];
    reconfigure(tab, wrapCompartment.reconfigure(extension));
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
    if (tab.editor === null || tab.editor.indent.source !== 'settings') continue;
    setIndentOf(tab, { ...fallback, source: 'settings' });
  }
}

/** Сменить отступ вкладки вручную — из строки состояния. */
export function setIndent(id: number, indent: Omit<Indent, 'source'>): void {
  const tab = tabById(id);
  if (tab?.editor) setIndentOf(tab, { ...indent, source: 'manual' });
}

function setIndentOf(tab: Tab, indent: Indent): void {
  if (!tab.editor) return;
  tab.editor.indent = indent;
  reconfigure(tab, indentCompartment.reconfigure(indentExtension(indent)));
}

/**
 * Применить живое превью ко всем вкладкам.
 *
 * По вкладке, а не одним значением на всех: превью включается только
 * у markdown (Р-159), и у соседней вкладки с кодом отсек обязан остаться
 * пустым. Тот же ход, что у переноса с читаемой шириной.
 */
export function applyLivePreview(): void {
  for (const tab of tabs.items) {
    if (!tab.editor) continue;
    const extension = livePreviewExtension(livePreviewOf(tab), () => tab.meta.path);
    reconfigure(tab, livePreviewCompartment.reconfigure(extension));
  }
}

/**
 * Применить настройку номеров строк ко всем вкладкам.
 *
 * По вкладке, а не одним значением на всех: при `code` ответ зависит
 * от языка, и у соседней вкладки с кодом номера обязаны остаться. Тот же
 * ход, что у живого превью.
 */
export function applyLineNumbers(): void {
  for (const tab of tabs.items) {
    if (!tab.editor) continue;
    const extension = lineNumbersExtension(lineNumbersOf(tab));
    reconfigure(tab, lineNumbersCompartment.reconfigure(extension));
  }
}

/** То же самое для невидимых символов. */
export function applyInvisibles(show: boolean): void {
  const extension = invisiblesExtension(show);
  for (const tab of tabs.items) {
    reconfigure(tab, invisiblesCompartment.reconfigure(extension));
  }
}

/** То же самое для автозакрытия скобок и по тем же причинам. */
export function applyAutoClose(autoClose: boolean): void {
  const extension = autoCloseExtension(autoClose);
  for (const tab of tabs.items) {
    reconfigure(tab, autoCloseCompartment.reconfigure(extension));
  }
}

/**
 * Вкладка, которую только показывают: картинка или PDF.
 *
 * Байты здесь не появляются: их спросит показ, когда вкладка окажется
 * на экране. Масштаб и страница у уже открытой вкладки сохраняются —
 * повторное открытие того же файла не повод сбрасывать то, что человек
 * выбрал; сбрасывается только жалоба, чтобы показ попробовал снова.
 */
function putViewed(meta: Buffer): void {
  const existing = tabById(meta.id);

  if (existing) {
    existing.meta = meta;

    if (meta.kind === 'image') {
      if (existing.image) {
        // Файл могли подменить на диске — показ перечитает его заново.
        existing.image.source = null;
        existing.image.problem = null;
      } else {
        existing.image = freshImage();
      }
    } else if (existing.pdf) {
      existing.pdf.problem = null;
    } else {
      existing.pdf = freshPdf();
    }
  } else {
    tabs.items.push({
      meta,
      editor: null,
      image: meta.kind === 'image' ? freshImage() : null,
      pdf: meta.kind === 'pdf' ? freshPdf() : null,
    });
  }

  // В активную область — то же, что только что сделало ядро.
  openLocal(meta.id);
  noteStructureChange();
}

function put(
  meta: Buffer,
  text: string,
  cursor = 0,
  scrollTop = 0,
  language: string | null = null,
): void {
  // Вид решает, чем вкладка станет. Текста у картинки и PDF нет — ядро
  // и не читало файл, оно вернуло одни сведения о нём.
  if (meta.kind === 'image' || meta.kind === 'pdf') {
    putViewed(meta);
    return;
  }

  // Отступ определяется один раз, по содержимому: перечитывать его на каждой
  // правке значило бы менять поведение `Tab` посреди набора.
  const indent = resolveIndent(text, indentSettings());
  const state = makeState(meta, text, cursor, indent);
  baselines.set(meta.id, state.doc);

  const editor: TabEditor = {
    state,
    scrollTop,
    language,
    indent,
    home: null,
    mirrors: {},
    // Открытая заново вкладка ничего из сессии не ждёт: её курсор пришёл
    // вместе с ней.
    restored: {},
  };

  const existing = tabById(meta.id);
  if (existing) {
    existing.meta = meta;
    existing.editor = editor;
  } else {
    tabs.items.push({ meta, editor, image: null, pdf: null });
  }
  // В активную область — то же, что только что сделало ядро. До языка:
  // подстановка языка проверяет, активна ли вкладка.
  openLocal(meta.id);
  // Язык грузится и встаёт на место сам: ждать его открытие файла не должно.
  void applyLanguage(meta.id);
  noteStructureChange();
}

/**
 * Какой язык должен действовать на вкладке.
 *
 * Выбор пользователя главнее имени файла: он для того и сделан.
 */
/**
 * Переносить ли строки на этой вкладке.
 *
 * Не просто настройка: читаемая ширина markdown включает перенос сама
 * (Р-156). Правило лежит в `editor/readable.ts` чистой функцией и оттуда же
 * проверяется тестом — здесь только подстановка того, что знает вкладка.
 */
export function livePreviewOf(tab: Tab): boolean {
  if (!tab.editor) return false;
  return livePreviewOn({
    livePreview: livePreviewEnabled(),
    markdown: languageOf(tab)?.id === 'markdown',
  });
}

export function lineNumbersOf(tab: Tab): boolean {
  if (!tab.editor) return false;
  return lineNumbersOn({
    setting: lineNumbersSetting(),
    markdown: languageOf(tab)?.id === 'markdown',
  });
}

export function wrapOf(tab: Tab): boolean {
  if (!tab.editor) return false;
  return wrapFor({
    wrap: wrapEnabled(),
    readableWidth: readableWidthEnabled(),
    markdown: languageOf(tab)?.id === 'markdown',
  });
}

export function languageOf(tab: Tab): Language | null {
  // У вкладки, которая не текст, языка нет — и это ответ, а не отговорка:
  // от него зависят панель разметки, превью и колонка читаемой ширины,
  // и все они над параметрами показываться не должны.
  if (!tab.editor) return null;

  return tab.editor.language !== null
    ? languageById(tab.editor.language)
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
  if (!tab?.editor) return;

  // Свыше порога подсветки нет — это записанная политика больших файлов:
  // разбор десятков мегабайт съел бы и память, и отзывчивость.
  const language = tab.meta.large ? null : languageOf(tab);
  const support = language ? await language.load() : [];

  // За время загрузки вкладку могли закрыть или переключить язык ещё раз.
  const current = tabById(id);
  if (!current?.editor || languageOf(current)?.id !== language?.id) return;

  // Живое представление правится, только если в нём лежит именно это
  // состояние (Р-105) — проверку делает `applyToSlot`, и она обязательна:
  // сюда попадают и синхронно. У буфера без языка — новый файл, `.txt`,
  // незнакомое расширение — ветка `support` не содержит `await` вовсе,
  // и вся функция выполняется прямо внутри `put`, когда представление ещё
  // показывает прошлую вкладку. Без проверки новой вкладке доставалось
  // чужое состояние, и её содержимое пропадало ещё до первой отрисовки
  // (задача 30). Условия «вкладка активна» для этого мало.
  reconfigure(current, languageCompartment.reconfigure(support));
}

/** Выбрать язык подсветки вручную. `null` — снова определять по имени. */
export function setLanguage(id: number, language: string | null): void {
  const tab = tabById(id);
  if (!tab?.editor) return;

  tab.editor.language = language;
  void applyLanguage(id);
  // Язык сменился — вместе с ним меняется и то, что зависит от «это markdown»:
  // колонка с переносом (Р-156) и живое превью (Р-159). Без этого выбор
  // «Markdown» в строке состояния не давал бы ни того ни другого до первой
  // правки настроек.
  applyWrap();
  applyLivePreview();
  // И номера строк: у заметки их нет, у кода есть (Р-213).
  applyLineNumbers();
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
  if (tab?.editor) {
    baselines.set(id, tab.editor.state.doc);
    // Буфер сохранён — теперь есть с чем сравнивать, подпорка не нужна.
    restoredDirty.delete(id);
  }
}

/**
 * Показать вкладку по номеру: в активной области, если она там есть,
 * иначе в первой области, где есть, — и та становится активной (Р-210).
 * Точка входа для всего, что зовёт вкладку не с её полосы: панель закладок,
 * обратные ссылки, переход по ссылке.
 */
export function setActive(id: number): void {
  const pane = paneShowing(id);
  if (!pane) return;
  setActiveTab(pane.id, id);
}

/**
 * Курсор вкладки в этой области — для истории мест (задача 85).
 *
 * `null` означает «места больше нет»: вкладку закрыли. Область при этом
 * не проверяется: она могла схлопнуться, а вкладка остаться в другой,
 * и возвращаться туда — правильнее, чем не возвращаться никуда.
 */
export function cursorAt(place: { tab: number; pane: number }): number | null {
  const editor = tabById(place.tab)?.editor;
  if (!editor) return null;

  const slot = editor.home === place.pane ? editor : editor.mirrors[place.pane];
  return (slot ?? editor).state.selection.main.head;
}

/**
 * Перейти в место из истории: область, вкладка, курсор.
 *
 * Область берётся из места, если вкладка там и правда есть; иначе любая,
 * где она есть. Курсор ставится через представление, когда оно на экране,
 * и прямо в состояние, когда нет, — то же условие, что в Р-105.
 */
export function goToPlace(place: { tab: number; pane: number; pos: number }): void {
  const tab = tabById(place.tab);
  if (!tab?.editor) return;

  const pane = paneById(place.pane)?.tabs.includes(place.tab)
    ? paneById(place.pane)
    : paneShowing(place.tab);
  if (!pane) return;

  // Один вызов, а не два: `setActiveTab` сам делает область активной.
  // С двумя между ними возникало состояние «новая область, старая вкладка» —
  // место, где человек не был, — и история записывала его как переход,
  // стирая путь вперёд. Найдено на живом окне.
  setActiveTab(pane.id, place.tab);

  const slot = slotFor(tab, pane.id);
  if (!slot) return;

  const anchor = Math.min(place.pos, slot.state.doc.length);
  const view = editorViewOf(pane.id);

  if (view && view.state === slot.state) {
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    view.focus();
    return;
  }

  slot.state = slot.state.update({ selection: { anchor }, scrollIntoView: true }).state;
}

/** Переключение вкладок по кругу — внутри своей области (Р-210). */
function step(delta: 1 | -1): void {
  const pane = activePane();
  const list = pane.tabs;
  if (list.length === 0) return;
  const index = pane.active === null ? -1 : list.indexOf(pane.active);
  const from = index < 0 ? 0 : index;
  const next = (from + delta + list.length) % list.length;
  setActiveTab(pane.id, list[next]!);
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

/** Курсоры этой вкладки по областям — из плоского списка, каким их дало ядро. */
function restoredFor(
  views: PaneView[],
  id: number,
): Record<number, { cursor: number; scrollTop: number }> {
  const out: Record<number, { cursor: number; scrollTop: number }> = {};
  for (const view of views) {
    if (view.buffer === id) {
      out[view.pane] = { cursor: view.cursor, scrollTop: view.scrollTop };
    }
  }
  return out;
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

    // Вкладка, которая не текст, приезжает одним своим видом: ни состояния
    // редактора, ни языка, ни отступа у неё нет и быть не может. Картинке
    // заводится состояние показа — пустое: байты возьмёт показ.
    if (meta.kind !== 'text') {
      tabs.items.push({
        meta,
        editor: null,
        image: meta.kind === 'image' ? freshImage() : null,
        pdf: meta.kind === 'pdf' ? freshPdf() : null,
      });
      continue;
    }

    const indent = resolveIndent(text, indentSettings());
    const state = makeState(meta, text, cursor, indent, bookmarks ?? []);

    if (meta.modified) {
      restoredDirty.add(meta.id);
    }
    baselines.set(meta.id, state.doc);
    tabs.items.push({
      meta,
      editor: {
        state,
        scrollTop,
        language: language ?? null,
        indent,
        home: null,
        mirrors: {},
        restored: restoredFor(session.paneViews, meta.id),
      },
      image: null,
      pdf: null,
    });
    // Язык подтягивается в фоне: старт не должен ждать разбора парсеров.
    void applyLanguage(meta.id);
  }

  await restoreFromSession(
    session.roots,
    session.sidebar,
    session.sidebarWidth,
    session.sidebarPanel,
  );

  // Раскладка приезжает из ядра готовой: порядок вкладок, активные,
  // форма окна. Ядро уже сверило её с тем, что восстановилось.
  applyLayout(session.layout);
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

/**
 * Открыть параметры вкладкой.
 *
 * Вторая точка входа в список вкладок после файла — и обе ведут в ядро.
 * Вкладка параметров там одна, поэтому повторный вызов не заводит вторую,
 * а показывает открытую: закрывается она крестиком, как всякая вкладка,
 * а не тем же нажатием, которым открылась (замечание владельца).
 */
export async function openSettings(): Promise<void> {
  const meta = await ipc.openSettingsTab();

  const existing = tabById(meta.id);
  if (existing) {
    existing.meta = meta;
  } else {
    tabs.items.push({ meta, editor: null, image: null, pdf: null });
  }

  // В активную область — то же, что только что сделало ядро.
  openLocal(meta.id);
  noteStructureChange();
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

/**
 * Закрыть буфер совсем — из реестра и из всех областей.
 *
 * Кто станет активной вкладкой и не схлопнется ли область, решает ядро
 * (Р-211): раскладка приходит в ответе, и здесь она просто применяется.
 * Убрать вкладку из одной области, оставив буфер в другой, — это
 * `removeTab` в `state/panes`, и до сюда такое не доходит.
 */
export async function close(id: number): Promise<void> {
  const index = tabs.items.findIndex((t) => t.meta.id === id);
  if (index < 0) return;

  const layout = await ipc.closeBuffer(id);
  tabs.items.splice(index, 1);
  baselines.delete(id);
  restoredDirty.delete(id);
  applyLayout(layout);
  // Черновик закрытой вкладки больше не нужен: восстанавливать её не будем.
  await forgetDraft(id);

  noteStructureChange();
}

// Раскладка меняется в `state/panes`, а состояния вкладок живут здесь:
// после каждой замены дерева зеркала без области убираются, а главное
// без области передаётся зеркалу (Р-209).
registerLayoutListener(reconcileMirrors);
