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

const { activeTab, createEmpty, slotFor, tabs } = await import('../src/state/tabs.svelte');
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
