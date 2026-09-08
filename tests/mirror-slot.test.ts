import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Зеркало вкладки (Р-209) создаётся из главного состояния без окна:
 * тот же текст, свои курсоры, отсеки скопированы. Ядро подменено.
 */

const EMPTY_LAYOUT = {
  root: { kind: 'pane' as const, id: 1, tabs: [] as number[], active: null },
  activePane: 1,
  nextId: 2,
};

vi.mock('../src/ipc/files', () => ({
  newBuffer: vi.fn(async () => ({
    id: 5,
    kind: 'text',
    path: null,
    title: 'Без имени 5',
    encoding: 'utf8',
    bom: false,
    eol: 'lf',
    eolMixed: false,
    modified: false,
    large: false,
    lossy: false,
    encodingConfident: true,
    readOnly: false,
  })),
  setModified: vi.fn(async () => undefined),
  openFile: vi.fn(),
  closeBuffer: vi.fn(async () => EMPTY_LAYOUT),
  restoreSession: vi.fn(),
}));

vi.mock('../src/ipc/layout', () => ({
  setActiveTab: vi.fn(async () => EMPTY_LAYOUT),
  setActivePane: vi.fn(async () => EMPTY_LAYOUT),
  reorderTab: vi.fn(async () => EMPTY_LAYOUT),
  removeTab: vi.fn(async () => EMPTY_LAYOUT),
  splitPane: vi.fn(async () => EMPTY_LAYOUT),
  closePane: vi.fn(async () => EMPTY_LAYOUT),
  moveTab: vi.fn(async () => EMPTY_LAYOUT),
  moveTabToSplit: vi.fn(async () => EMPTY_LAYOUT),
  setSplitRatio: vi.fn(async () => EMPTY_LAYOUT),
  layoutState: vi.fn(async () => EMPTY_LAYOUT),
}));

vi.mock('../src/state/persist.svelte', () => ({
  noteEdit: vi.fn(),
  noteStructureChange: vi.fn(),
  forgetDraft: vi.fn(async () => undefined),
  flushNow: vi.fn(async () => undefined),
}));

vi.mock('../src/state/settings.svelte', () => ({
  wrapEnabled: () => false,
  autoCloseEnabled: () => true,
  indentSettings: () => ({ style: 'spaces', width: 4 }),
  invisiblesEnabled: () => false,
  readableWidthEnabled: () => true,
  livePreviewEnabled: () => true,
  lineNumbersSetting: () => 'code',
}));

vi.mock('../src/state/roots.svelte', () => ({
  restoreFromSession: vi.fn(async () => undefined),
}));

const { activeTab, createEmpty, paneViewsOf, slotFor, tabs } = await import(
  '../src/state/tabs.svelte'
);
const { applyLayout } = await import('../src/state/panes.svelte');

describe('зеркало вкладки', () => {
  beforeEach(() => {
    tabs.items = [];
    applyLayout(structuredClone(EMPTY_LAYOUT));
  });

  it('главное достаётся первой области, второй — зеркало с тем же текстом', async () => {
    await createEmpty('текст вкладки');
    const tab = activeTab()!;

    const primary = slotFor(tab, 1);
    expect(primary).toBe(tab.editor);
    expect(tab.editor?.home).toBe(1);

    const mirror = slotFor(tab, 2);
    expect(mirror).not.toBeNull();
    expect(mirror).not.toBe(tab.editor);
    expect(mirror!.state.doc.toString()).toBe('текст вкладки');
    expect(tab.editor?.mirrors[2]).toBe(mirror);

    // Повторный запрос отдаёт то же зеркало, а не новое.
    expect(slotFor(tab, 2)).toBe(mirror);
  });
});

/**
 * Курсор зеркала в сессии (задача 84).
 *
 * Долг этапа 11: после перезапуска зеркало вставало на курсор главного,
 * потому что в снимке буфера курсор один, а представлений у файла столько,
 * сколько областей.
 */
describe('курсоры по областям', () => {
  /** Две области, и в обеих одна и та же вкладка. */
  const SPLIT = {
    root: {
      kind: 'split' as const,
      id: 3,
      direction: 'row' as const,
      ratio: 0.5,
      first: { kind: 'pane' as const, id: 1, tabs: [5], active: 5 },
      second: { kind: 'pane' as const, id: 2, tabs: [5], active: 5 },
    },
    activePane: 1,
    nextId: 4,
  };

  beforeEach(() => {
    tabs.items = [];
    applyLayout(structuredClone(EMPTY_LAYOUT));
  });

  it('в снимок уезжает по курсору на область, а не один на файл', async () => {
    await createEmpty('текст вкладки');
    applyLayout(structuredClone(SPLIT));

    const tab = activeTab()!;
    const primary = slotFor(tab, 1)!;
    const mirror = slotFor(tab, 2)!;

    primary.state = primary.state.update({ selection: { anchor: 2 } }).state;
    mirror.state = mirror.state.update({ selection: { anchor: 9 } }).state;
    mirror.scrollTop = 120;

    const views = paneViewsOf();

    expect(views).toEqual([
      { pane: 1, buffer: 5, cursor: 2, scrollTop: 0 },
      { pane: 2, buffer: 5, cursor: 9, scrollTop: 120 },
    ]);
  });

  /**
   * Зеркало создаётся лениво, а сессия восстанавливается вся сразу: курсор
   * ждёт своего представления и достаётся ему при создании.
   */
  it('курсор из сессии достаётся зеркалу, а не главному', async () => {
    await createEmpty('текст вкладки');
    applyLayout(structuredClone(SPLIT));

    const tab = activeTab()!;
    tab.editor!.restored = { 2: { cursor: 7, scrollTop: 64 } };

    const primary = slotFor(tab, 1)!;
    expect(primary.state.selection.main.head).toBe(0);

    const mirror = slotFor(tab, 2)!;
    expect(mirror.state.selection.main.head).toBe(7);
    expect(mirror.scrollTop).toBe(64);

    // Запись одноразовая: второй раз возвращать курсор туда, откуда человек
    // уже ушёл, хуже, чем не возвращать вовсе.
    expect(tab.editor!.restored[2]).toBeUndefined();
  });

  /**
   * Область, которую ни разу не рисовали, своего представления не имеет —
   * и её курсор обязан уехать в снимок таким, каким пришёл. Иначе первый же
   * перезапуск без показа второй области стирал бы то, что она помнила.
   */
  it('курсор непоказанной области не теряется', async () => {
    await createEmpty('текст вкладки');
    applyLayout(structuredClone(SPLIT));

    const tab = activeTab()!;
    tab.editor!.restored = { 2: { cursor: 5, scrollTop: 32 } };
    slotFor(tab, 1);

    expect(paneViewsOf()).toContainEqual({
      pane: 2,
      buffer: 5,
      cursor: 5,
      scrollTop: 32,
    });
  });
});
