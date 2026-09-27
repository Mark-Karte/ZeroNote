import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Buffer } from '../src/ipc/files';

/**
 * Признак «изменён» не теряется, а закрытие не проходит мимо вопроса
 * (задача 136, находки С2, С3, С4, С10, С13 ревизии).
 *
 * Все пять — об одном: вкладка, в которой есть что терять, в какой-то
 * момент считалась чистой, и дальше её закрывали без вопроса, а черновик
 * удаляли. Ядро здесь подменено: проверяется, что фронтенд делает
 * с признаком и с закрытием.
 */

function meta(id: number, path: string | null, modified = false): Buffer {
  return {
    id,
    kind: 'text',
    path,
    title: path ? path.slice(path.lastIndexOf('\\') + 1) : `Без имени ${id}`,
    encoding: 'utf8',
    bom: false,
    eol: 'lf',
    eolMixed: false,
    modified,
    large: false,
    lossy: false,
    encodingConfident: true,
    readOnly: false,
    disk: { modifiedMs: 1, size: 4 },
  };
}

const EMPTY_LAYOUT = {
  root: { kind: 'pane' as const, id: 1, tabs: [] as number[], active: null },
  activePane: 1,
  nextId: 2,
};

vi.mock('../src/ipc/files', () => ({
  openFile: vi.fn(),
  reloadBuffer: vi.fn(),
  saveBuffer: vi.fn(),
  convertEncoding: vi.fn(),
  markDetached: vi.fn(),
  acceptExternal: vi.fn(),
  checkExternal: vi.fn(async () => []),
  setModified: vi.fn(async () => undefined),
  closeBuffer: vi.fn(async () => EMPTY_LAYOUT),
  newBuffer: vi.fn(),
  restoreSession: vi.fn(),
  moveBuffer: vi.fn(),
}));

vi.mock('../src/ipc/layout', () => ({
  setActiveTab: vi.fn(async () => EMPTY_LAYOUT),
  setActivePane: vi.fn(async () => EMPTY_LAYOUT),
  reorderTab: vi.fn(async () => EMPTY_LAYOUT),
  removeTab: vi.fn(async () => EMPTY_LAYOUT),
  splitPane: vi.fn(async () => EMPTY_LAYOUT),
  closePane: vi.fn(async () => EMPTY_LAYOUT),
  moveTab: vi.fn(async () => EMPTY_LAYOUT),
  setSplitRatio: vi.fn(async () => EMPTY_LAYOUT),
  layoutState: vi.fn(async () => EMPTY_LAYOUT),
}));

vi.mock('../src/ipc/tree', () => ({
  deleteEntry: vi.fn(async () => undefined),
}));

vi.mock('../src/state/tree.svelte', () => ({
  refreshDirs: vi.fn(async () => undefined),
}));

vi.mock('../src/state/persist.svelte', () => ({
  noteEdit: vi.fn(),
  noteStructureChange: vi.fn(),
  forgetDraft: vi.fn(async () => undefined),
  flushNow: vi.fn(async () => undefined),
}));

vi.mock('../src/state/settings.svelte', () => ({
  wrapEnabled: () => false,
  autosaveEnabled: () => false,
  autoCloseEnabled: () => true,
  indentSettings: () => ({ style: 'spaces', width: 4 }),
  invisiblesEnabled: () => false,
  readableWidthEnabled: () => true,
  livePreviewEnabled: () => true,
  noteTitleEnabled: () => true,
  lineNumbersSetting: () => 'code',
}));

vi.mock('../src/state/roots.svelte', () => ({
  restoreFromSession: vi.fn(async () => undefined),
}));

vi.mock('../src/state/modal.svelte', () => ({
  askChoice: vi.fn(async () => 'cancel'),
  askInput: vi.fn(async () => null),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(async () => undefined),
}));

const ipc = await import('../src/ipc/files');
const layoutIpc = await import('../src/ipc/layout');
const modal = await import('../src/state/modal.svelte');
const persist = await import('../src/state/persist.svelte');
const tabsState = await import('../src/state/tabs.svelte');
const { openPath, tabById, contentOf, tabs, undoActive, close } = tabsState;
const { applyLayout } = await import('../src/state/panes.svelte');
const { setEditorView } = await import('../src/editor/current');
const files = await import('../src/actions/files');
const { convertTo } = await import('../src/actions/encoding');
const { deleteEntry } = await import('../src/actions/entries');
const { checkExternalChanges } = await import('../src/actions/external');

async function open(id: number, path: string, text: string): Promise<void> {
  vi.mocked(ipc.openFile).mockResolvedValueOnce({ ...meta(id, path), text, reused: false });
  await openPath(path);
}

/** Напечатать в начало вкладки — с записью в историю, как это сделал бы человек. */
function type(id: number, text: string): void {
  const tab = tabById(id)!;
  tab.editor!.state = tab.editor!.state.update({
    changes: { from: 0, insert: text },
    userEvent: 'input',
  }).state;
  tab.meta = { ...tab.meta, modified: true };
}

/**
 * Представление активной области. Отмена идёт через него, а если главное
 * вкладки в другом месте — считается на главном (Р-209), что здесь и нужно:
 * вкладка ни в одной области не показана.
 */
function someView(): EditorView {
  const view = {
    state: EditorState.create({ doc: '' }),
    dispatch(spec: Parameters<EditorState['update']>[0]) {
      view.state = view.state.update(spec).state;
    },
  };
  return view as unknown as EditorView;
}

beforeEach(() => {
  tabs.items = [];
  applyLayout(structuredClone(EMPTY_LAYOUT));
  setEditorView(1, someView());
  vi.clearAllMocks();
  // Подмена ответа ядра на закрытие — своя у каждого теста: тест про два
  // закрытия подряд ставит ожидание, и без сброса оно протекало бы дальше.
  // Раскладка — копией: `applyLayout` кладёт объект как есть.
  vi.mocked(ipc.closeBuffer).mockImplementation(async () => structuredClone(EMPTY_LAYOUT));
  // И ответы «на один раз» — тоже: на старом коде вопрос, которого
  // не задали, оставлял свой ответ следующему тесту, и тот проходил
  // не по делу.
  for (const mock of [
    ipc.openFile,
    ipc.saveBuffer,
    ipc.convertEncoding,
    ipc.markDetached,
    ipc.checkExternal,
    modal.askChoice,
  ]) {
    vi.mocked(mock).mockReset();
  }
  vi.mocked(ipc.checkExternal).mockResolvedValue([]);
  vi.mocked(modal.askChoice).mockResolvedValue('cancel');
});

describe('сохранение', () => {
  it('набранное во время записи не считается сохранённым (С4)', async () => {
    await open(1, 'C:\\a.txt', 'текст');
    type(1, 'правка ');

    // Пока ядро пишет файл, человек печатает дальше.
    vi.mocked(ipc.saveBuffer).mockImplementationOnce(async () => {
      type(1, '!');
      return { conflict: false, buffer: meta(1, 'C:\\a.txt', false) };
    });

    expect(await files.save(1)).toBe(true);

    const tab = tabById(1)!;
    expect(contentOf(tab.editor!)).toBe('!правка текст');
    expect(tab.meta.modified).toBe(true);
    expect(ipc.setModified).toHaveBeenCalledWith(1, true);
    // Черновик нужен: «!» есть только в памяти.
    expect(persist.forgetDraft).not.toHaveBeenCalled();
  });

  it('без правки во время записи вкладка чиста, черновик удалён', async () => {
    await open(1, 'C:\\a.txt', 'текст');
    type(1, 'правка ');
    vi.mocked(ipc.saveBuffer).mockResolvedValueOnce({
      conflict: false,
      buffer: meta(1, 'C:\\a.txt', false),
    });

    expect(await files.save(1)).toBe(true);

    expect(tabById(1)!.meta.modified).toBe(false);
    expect(persist.forgetDraft).toHaveBeenCalledWith(1);
  });
});

describe('изменение не в тексте', () => {
  it('смена кодировки переживает правку и её отмену (С10)', async () => {
    await open(1, 'C:\\a.txt', 'текст');
    vi.mocked(ipc.convertEncoding).mockResolvedValueOnce({
      ...meta(1, 'C:\\a.txt', true),
      encoding: 'windows1251',
    });
    await convertTo(1, 'windows1251');

    type(1, 'x');
    undoActive();

    const tab = tabById(1)!;
    expect(contentOf(tab.editor!)).toBe('текст');
    expect(tab.meta.modified).toBe(true);
    expect(ipc.setModified).not.toHaveBeenCalledWith(1, false);
  });

  it('содержимое удалённого снаружи файла не становится «чистым» (С10)', async () => {
    await open(1, 'C:\\a.txt', 'единственная копия');
    vi.mocked(ipc.checkExternal).mockResolvedValueOnce([{ id: 1, status: 'removed' }]);
    vi.mocked(modal.askChoice).mockResolvedValueOnce('keep');
    vi.mocked(ipc.markDetached).mockResolvedValueOnce({
      ...meta(1, 'C:\\a.txt', true),
      disk: null,
    });
    await checkExternalChanges();

    type(1, 'a');
    undoActive();

    expect(tabById(1)!.meta.modified).toBe(true);
  });
});

describe('закрытие окна', () => {
  /** Две области, и в обеих одна и та же вкладка — зеркало (Р-209). */
  const SPLIT = {
    root: {
      kind: 'split' as const,
      id: 3,
      direction: 'row' as const,
      ratio: 0.5,
      first: { kind: 'pane' as const, id: 1, tabs: [1], active: 1 },
      second: { kind: 'pane' as const, id: 2, tabs: [1], active: 1 },
    },
    activePane: 1,
    nextId: 4,
  };

  it('спрашивает про изменённый буфер, показанный в двух областях (С3)', async () => {
    await open(1, 'C:\\a.txt', 'текст');
    applyLayout(structuredClone(SPLIT));
    type(1, 'правка ');
    vi.mocked(modal.askChoice).mockResolvedValueOnce('cancel');

    expect(await files.closeAllTabs()).toBe(false);

    expect(modal.askChoice).toHaveBeenCalledOnce();
    expect(tabById(1)).not.toBeNull();
    expect(layoutIpc.removeTab).not.toHaveBeenCalled();
  });

  /**
   * Найдено живой проверкой задачи 136: закрытие шло по вкладкам подряд,
   * и к вопросу про третью первые две были уже закрыты. «Отмена» оставляла
   * окно без них — и сессию тоже.
   */
  it('«Отмена» не оставляет окно без чистых вкладок', async () => {
    await open(1, 'C:\\a.txt', 'чистая');
    await open(2, 'C:\\b.txt', 'текст');
    type(2, 'правка ');
    vi.mocked(modal.askChoice).mockResolvedValueOnce('cancel');

    expect(await files.closeAllTabs()).toBe(false);

    expect(tabs.items.map((tab) => tab.meta.id)).toEqual([1, 2]);
    expect(ipc.closeBuffer).not.toHaveBeenCalled();
  });

  it('«Не сохранять» закрывает всё без второго вопроса', async () => {
    await open(1, 'C:\\a.txt', 'чистая');
    await open(2, 'C:\\b.txt', 'текст');
    type(2, 'правка ');
    vi.mocked(modal.askChoice).mockResolvedValueOnce('discard');

    expect(await files.closeAllTabs()).toBe(true);

    expect(modal.askChoice).toHaveBeenCalledOnce();
    expect(tabs.items).toEqual([]);
  });

  it('вкладка из одной области при зеркале уходит молча — терять нечего', async () => {
    await open(1, 'C:\\a.txt', 'текст');
    applyLayout(structuredClone(SPLIT));
    type(1, 'правка ');

    expect(await files.closeTab(1, 2)).toBe(true);

    expect(modal.askChoice).not.toHaveBeenCalled();
    expect(layoutIpc.removeTab).toHaveBeenCalledWith(2, 1);
  });
});

describe('два закрытия подряд', () => {
  it('убирают одну вкладку, а не заодно соседнюю (С13)', async () => {
    await open(1, 'C:\\a.txt', 'а');
    await open(2, 'C:\\b.txt', 'б');
    await open(3, 'C:\\c.txt', 'в');

    // Ядро занято: оба запроса ждут, и отвечает оно после второго.
    let release: () => void = () => {};
    const busy = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(ipc.closeBuffer).mockImplementation(async () => {
      await busy;
      return structuredClone(EMPTY_LAYOUT);
    });

    const first = close(1);
    const second = close(1);
    release();
    await Promise.all([first, second]);

    expect(tabs.items.map((tab) => tab.meta.id)).toEqual([2, 3]);
  });
});

describe('удаление в дереве', () => {
  it('не выбрасывает несохранённые правки открытого файла (С2)', async () => {
    await open(1, 'C:\\папка\\план.txt', 'текст');
    type(1, 'правка ');
    vi.mocked(modal.askChoice).mockResolvedValueOnce('delete');
    vi.mocked(ipc.markDetached).mockResolvedValueOnce({
      ...meta(1, 'C:\\папка\\план.txt', true),
      disk: null,
    });

    await deleteEntry('C:\\папка', 'папка', true);

    const tab = tabById(1);
    expect(tab).not.toBeNull();
    expect(contentOf(tab!.editor!)).toBe('правка текст');
    expect(tab!.meta.modified).toBe(true);
    expect(persist.forgetDraft).not.toHaveBeenCalled();
  });

  it('чистую вкладку удалённого закрывает, как и раньше', async () => {
    await open(1, 'C:\\папка\\план.txt', 'текст');
    vi.mocked(modal.askChoice).mockResolvedValueOnce('delete');

    await deleteEntry('C:\\папка', 'папка', true);

    expect(tabById(1)).toBeNull();
  });
});
