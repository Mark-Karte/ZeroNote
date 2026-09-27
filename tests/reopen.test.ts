import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Buffer } from '../src/ipc/files';

/**
 * Несохранённые правки переживают повторное открытие и тихое перечитывание
 * (задача 135, находки Ф1, С1, С5, С6 ревизии).
 *
 * До задачи 135 повторное открытие уже открытого файла — щелчок в дереве,
 * переход по `[[ссылке]]`, быстрое открытие, выдача поиска — перечитывало
 * его с диска и подменяло вкладку: правки пропадали без вопроса, и отмена
 * их не возвращала. Жило это с задачи 4.1; тестов на путь не было,
 * `openFile` в них был пустой заглушкой.
 *
 * Ядро здесь подменено: проверяется, что фронтенд делает с ответом.
 * Какой ответ ядро даёт на повторное открытие, сверяет тест в Rust
 * (`commands::files::tests::reopening_an_open_file_keeps_unsaved_edits`).
 */

function meta(id: number, path: string, modified = false): Buffer {
  return {
    id,
    kind: 'text',
    path,
    title: path.slice(path.lastIndexOf('\\') + 1),
    encoding: 'utf8',
    bom: false,
    eol: 'lf',
    eolMixed: false,
    modified,
    large: false,
    lossy: false,
    encodingConfident: true,
    readOnly: false,
    disk: null,
  };
}

vi.mock('../src/ipc/files', () => ({
  openFile: vi.fn(),
  reloadBuffer: vi.fn(),
  checkExternal: vi.fn(async () => []),
  acceptExternal: vi.fn(),
  markDetached: vi.fn(),
  setModified: vi.fn(async () => undefined),
  closeBuffer: vi.fn(),
  newBuffer: vi.fn(),
  restoreSession: vi.fn(),
}));

const EMPTY_LAYOUT = {
  root: { kind: 'pane' as const, id: 1, tabs: [] as number[], active: null },
  activePane: 1,
  nextId: 2,
};

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
  noteTitleEnabled: () => true,
  lineNumbersSetting: () => 'code',
}));

vi.mock('../src/state/roots.svelte', () => ({
  restoreFromSession: vi.fn(async () => undefined),
}));

// Вопрос «что оставить» отвечается подменой: тест про то, дойдёт ли
// до вопроса дело, а не про окно.
vi.mock('../src/state/modal.svelte', () => ({
  askChoice: vi.fn(async () => 'mine'),
}));

const ipc = await import('../src/ipc/files');
const modal = await import('../src/state/modal.svelte');
const { openPath, replaceContent, tabById, contentOf, tabs } = await import(
  '../src/state/tabs.svelte'
);
const { applyLayout, paneById } = await import('../src/state/panes.svelte');
const { checkExternalChanges } = await import('../src/actions/external');

/** Дописать в начало вкладки, как это сделал бы человек, и отметить правку. */
function type(id: number, text: string): void {
  const tab = tabById(id)!;
  tab.editor!.state = tab.editor!.state.update({ changes: { from: 0, insert: text } }).state;
  tab.meta = { ...tab.meta, modified: true };
}

describe('повторное открытие', () => {
  beforeEach(() => {
    tabs.items = [];
    applyLayout(structuredClone(EMPTY_LAYOUT));
    vi.clearAllMocks();
  });

  it('не подменяет вкладку с несохранёнными правками', async () => {
    const path = 'C:\\заметки\\a.txt';
    vi.mocked(ipc.openFile)
      .mockResolvedValueOnce({ ...meta(1, path), text: 'диск', reused: false })
      // Ядро узнало открытый файл: текста в ответе нет, его держит вкладка.
      .mockResolvedValueOnce({ ...meta(1, path, true), text: '', reused: true });

    await openPath(path);
    type(1, 'моё ');
    await openPath(path);

    const tab = tabById(1)!;
    expect(contentOf(tab.editor!)).toBe('моё диск');
    expect(tab.meta.modified).toBe(true);
    // И перечитывать за спиной ядро не просили.
    expect(ipc.reloadBuffer).not.toHaveBeenCalled();
  });

  it('делает вкладку активной, как любое открытие', async () => {
    vi.mocked(ipc.openFile)
      .mockResolvedValueOnce({ ...meta(1, 'C:\\a.txt'), text: 'а', reused: false })
      .mockResolvedValueOnce({ ...meta(2, 'C:\\b.txt'), text: 'б', reused: false })
      .mockResolvedValueOnce({ ...meta(1, 'C:\\a.txt'), text: '', reused: true });

    await openPath('C:\\a.txt');
    await openPath('C:\\b.txt');
    await openPath('C:\\a.txt');

    expect(paneById(1)!.active).toBe(1);
    expect(contentOf(tabById(1)!.editor!)).toBe('а');
  });
});

describe('тихое перечитывание', () => {
  beforeEach(() => {
    tabs.items = [];
    applyLayout(structuredClone(EMPTY_LAYOUT));
    vi.clearAllMocks();
  });

  it('не переносит вкладку в активную область и не делает её активной', async () => {
    vi.mocked(ipc.openFile)
      .mockResolvedValueOnce({ ...meta(1, 'C:\\a.txt'), text: 'старое', reused: false })
      .mockResolvedValueOnce({ ...meta(2, 'C:\\b.txt'), text: 'б', reused: false });
    await openPath('C:\\a.txt');
    await openPath('C:\\b.txt');

    replaceContent({ ...meta(1, 'C:\\a.txt'), text: 'новое' });

    expect(paneById(1)!.active).toBe(2);
    expect(contentOf(tabById(1)!.editor!)).toBe('новое');
  });

  it('оставляет курсор, прокрутку и выбранный язык', async () => {
    vi.mocked(ipc.openFile).mockResolvedValueOnce({
      ...meta(1, 'C:\\a.txt'),
      text: 'первая\nвторая',
      reused: false,
    });
    await openPath('C:\\a.txt');
    const tab = tabById(1)!;
    tab.editor!.state = tab.editor!.state.update({ selection: { anchor: 9 } }).state;
    tab.editor!.scrollTop = 120;
    tab.editor!.language = 'python';

    replaceContent({ ...meta(1, 'C:\\a.txt'), text: 'первая\nвторая\nтретья' });

    const after = tabById(1)!.editor!;
    expect(after.state.selection.main.head).toBe(9);
    expect(after.scrollTop).toBe(120);
    expect(after.language).toBe('python');
  });

  it('при возврате фокуса не стирает набранное, пока файл читался', async () => {
    vi.mocked(ipc.openFile).mockResolvedValueOnce({
      ...meta(1, 'C:\\a.txt'),
      text: 'диск',
      reused: false,
    });
    await openPath('C:\\a.txt');

    vi.mocked(ipc.checkExternal).mockResolvedValueOnce([{ id: 1, status: 'modified' }]);
    // Пока ядро читает файл, человек успевает напечатать: вкладка была
    // чистой, когда чтение началось, и стала изменённой к его концу.
    vi.mocked(ipc.reloadBuffer).mockImplementationOnce(async () => {
      type(1, 'x');
      return { ...meta(1, 'C:\\a.txt'), text: 'чужое' };
    });
    vi.mocked(ipc.acceptExternal).mockResolvedValueOnce(meta(1, 'C:\\a.txt', true));

    await checkExternalChanges();

    expect(contentOf(tabById(1)!.editor!)).toBe('xдиск');
    // Набранное не пропадает молча: человеку задан тот же вопрос,
    // что и про изменённую вкладку.
    expect(modal.askChoice).toHaveBeenCalledOnce();
  });
});
