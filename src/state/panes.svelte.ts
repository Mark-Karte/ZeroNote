import * as ipc from '../ipc/layout';
import type { Direction, Layout, LayoutNode, PaneNode, SplitNode } from '../ipc/layout';

/**
 * Раскладка — часть сессии, и каждая её перемена просит снимок.
 *
 * Импорт по требованию, а не обычный: `persist` тянет `tabs`, `tabs` тянет
 * этот модуль, а сюда ходит ещё и `editor/current`. Обычный импорт замыкал
 * бы круг на уровне модулей, и чей файл выполнится первым — тот и упадёт
 * на переменной, которая ещё не объявлена. Нашлось тестом, а не глазами.
 */
function noteStructureChange(): void {
  void import('./persist.svelte').then((persist) => persist.noteStructureChange());
}

/**
 * Области редактора (Р-207).
 *
 * Копия дерева из ядра. Всё, что меняет форму дерева — разделение,
 * перенос, закрытие области, — идёт через ядро, и ответ кладётся сюда
 * целиком. Своими руками здесь делаются ровно две вещи, и обе тривиальны:
 * «добавить вкладку в активную область» (так поступает каждая команда
 * открытия в ядре, и копия обязана поспеть за ней без второго запроса)
 * и «сделать вкладку активной» (ответ ядра всё равно приедет и подтвердит).
 *
 * Активная вкладка окна отсюда, а не отдельным полем рядом со списком
 * вкладок: два места, где записано одно и то же, расходятся молча.
 */
export const layout = $state<Layout>({
  root: { kind: 'pane', id: 1, tabs: [], active: null },
  activePane: 1,
  nextId: 2,
});

/**
 * Кого звать после каждой замены дерева.
 *
 * Состояния вкладок живут в `state/tabs`, и им надо знать, что область
 * исчезла или вкладка из неё ушла: зеркало без области — мусор, а главное
 * состояние без области надо передать зеркалу (Р-209). Крючок, а не импорт:
 * `tabs` уже импортирует этот модуль, и обратный импорт замкнул бы круг
 * на уровне модулей.
 */
let afterApply: (() => void) | null = null;

export function registerLayoutListener(listener: () => void): void {
  afterApply = listener;
}

export function applyLayout(next: Layout): void {
  layout.root = next.root;
  layout.activePane = next.activePane;
  layout.nextId = next.nextId;
  afterApply?.();
}

function findSplit(node: LayoutNode, id: number): SplitNode | null {
  if (node.kind === 'pane') return null;
  if (node.id === id) return node;
  return findSplit(node.first, id) ?? findSplit(node.second, id);
}

/**
 * Подвинуть границу только у себя: во время перетаскивания она едет много
 * раз в секунду, и итог уходит в ядро один раз — см. `setRatio`.
 */
export function setRatioLocal(splitId: number, ratio: number): void {
  const split = findSplit(layout.root, splitId);
  if (split) split.ratio = ratio;
}

/**
 * Разделить активную область: новая получает зеркало текущей вкладки,
 * как `Ctrl+\` в VS Code (Р-210). Без вкладки делить нечего.
 */
export async function splitActive(direction: Direction): Promise<void> {
  const pane = activePane();
  if (pane.active === null) return;
  await split(pane.id, direction, pane.active);
}

function collect(node: LayoutNode, out: PaneNode[]): void {
  if (node.kind === 'pane') {
    out.push(node);
  } else {
    collect(node.first, out);
    collect(node.second, out);
  }
}

/** Области слева направо и сверху вниз — порядок для `Ctrl+1…9` (Р-210). */
export function panes(): PaneNode[] {
  const out: PaneNode[] = [];
  collect(layout.root, out);
  return out;
}

export function paneById(id: number): PaneNode | null {
  return panes().find((pane) => pane.id === id) ?? null;
}

/** Активная область. В дереве всегда есть хотя бы одна. */
export function activePane(): PaneNode {
  return paneById(layout.activePane) ?? panes()[0]!;
}

/** Активная вкладка окна — активная вкладка активной области. */
export function activeTabId(): number | null {
  return activePane().active;
}

/** В каких областях лежит вкладка. Больше одной — зеркала (Р-209). */
export function panesWith(tabId: number): PaneNode[] {
  return panes().filter((pane) => pane.tabs.includes(tabId));
}

/**
 * Где показывать вкладку по её номеру: в активной области, если она там
 * есть, иначе в первой, где есть. `null` — нет нигде.
 */
export function paneShowing(tabId: number): PaneNode | null {
  const current = activePane();
  if (current.tabs.includes(tabId)) return current;
  return panesWith(tabId)[0] ?? null;
}

/**
 * Вкладка открыта в активной области — то же, что сделало ядро.
 *
 * Правило одно и то же с двух сторон, и это единственная копия логики
 * раскладки во фронтенде: команды открытия возвращают буфер, а не дерево,
 * и ходить за деревом вторым запросом на каждое открытие незачем.
 */
export function openLocal(id: number): void {
  const pane = activePane();
  if (!pane.tabs.includes(id)) {
    pane.tabs.push(id);
  }
  pane.active = id;
}

/** Вкладку выбрали: она активна в своей области, область — в окне (Р-210). */
export function setActiveTab(pane: number, id: number): void {
  const target = paneById(pane);
  if (!target || !target.tabs.includes(id)) return;

  // Сначала у себя, потом в ядре: интерфейс отвечает на щелчок сразу,
  // а ответ ядра приедет тем же деревом и ничего не изменит.
  target.active = id;
  layout.activePane = pane;
  void ipc.setActiveTab(pane, id).then((next) => {
    applyLayout(next);
    noteStructureChange();
  });
}

export function setActivePane(pane: number): void {
  if (!paneById(pane)) return;
  layout.activePane = pane;
  void ipc.setActivePane(pane).then(applyLayout);
}

/**
 * Переставить вкладку только на стороне интерфейса.
 *
 * Во время перетаскивания порядок меняется много раз в секунду, и звать
 * на каждый шаг команду ядра незачем. Итог отправляется один раз, когда
 * пользователь отпустил вкладку, — см. `commitReorder`.
 */
export function reorderLocal(pane: number, id: number, to: number): number {
  const target = paneById(pane);
  if (!target) return -1;
  const from = target.tabs.indexOf(id);
  if (from < 0) return -1;

  const index = Math.max(0, Math.min(to, target.tabs.length - 1));
  if (from === index) return index;

  target.tabs.splice(from, 1);
  target.tabs.splice(index, 0, id);
  return index;
}

/** Сообщить ядру итоговое место вкладки: порядок — часть сессии. */
export async function commitReorder(pane: number, id: number): Promise<void> {
  const index = paneById(pane)?.tabs.indexOf(id) ?? -1;
  if (index < 0) return;
  applyLayout(await ipc.reorderTab(pane, id, index));
  noteStructureChange();
}

/** Убрать вкладку из одной области, не закрывая буфер (Р-209). */
export async function removeTab(pane: number, id: number): Promise<void> {
  applyLayout(await ipc.removeTab(pane, id));
  noteStructureChange();
}

/**
 * Разделить область. Возвращает номер новой: она становится активной,
 * и ядро сообщает это самим деревом.
 */
export async function split(
  pane: number,
  direction: Direction,
  id: number | null,
): Promise<number> {
  applyLayout(await ipc.splitPane(pane, direction, id));
  noteStructureChange();
  return layout.activePane;
}

/** Закрыть область. Буферы без области закрывает вызывающий — до этого. */
export async function closePane(pane: number): Promise<void> {
  applyLayout(await ipc.closePane(pane));
  noteStructureChange();
}

export async function moveTab(
  id: number,
  from: number,
  to: number,
  at: number | null,
): Promise<void> {
  applyLayout(await ipc.moveTab(id, from, to, at));
  noteStructureChange();
}

export async function setRatio(splitId: number, ratio: number): Promise<void> {
  applyLayout(await ipc.setSplitRatio(splitId, ratio));
  noteStructureChange();
}
