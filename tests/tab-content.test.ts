import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Содержимое, попавшее во вкладку, обязано в ней остаться.
 *
 * Тест заведён по настоящему дефекту, найденному при переделке замера
 * (задача 30). У буфера без языка — новый файл, `.txt`, незнакомое
 * расширение — подстановка языка не содержит ни одного `await` и потому
 * выполняется синхронно, ещё внутри создания вкладки, когда живое
 * представление показывает прошлую. Она присваивала новой вкладке состояние
 * из представления, и содержимое пропадало до первой отрисовки.
 *
 * Цена ошибки — не косметика: путь у вкладки при этом остаётся свой,
 * и сохранение записало бы в файл чужой текст.
 *
 * Ядро здесь подменено: проверяется работа с состоянием, а не ввод-вывод.
 */

vi.mock('../src/ipc/files', () => ({
  newBuffer: vi.fn(async () => ({
    id: 7,
    path: null,
    title: 'Без имени 7',
    encoding: 'utf8',
    bom: false,
    eol: 'cr-lf',
    eolMixed: false,
    modified: false,
    large: false,
    lossy: false,
    encodingConfident: true,
    readOnly: false,
  })),
  setModified: vi.fn(async () => undefined),
  openFile: vi.fn(),
  closeBuffer: vi.fn(async () => true),
  restoreSession: vi.fn(),
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
}));

vi.mock('../src/state/roots.svelte', () => ({
  restoreFromSession: vi.fn(async () => undefined),
}));

const { activeTab, createEmpty, tabs } = await import('../src/state/tabs.svelte');
const { setEditorView } = await import('../src/editor/current');

/**
 * Заглушка представления: она держит **чужое** состояние и ведёт себя как
 * настоящая — `dispatch` и правда обновляет `state`.
 *
 * Честность здесь принципиальна. Первая версия просто бросала из `dispatch`,
 * и тест проходил, ничего не проверив: до присваивания дело не доходило,
 * а отвергнутое обещание терялось в `void`. Заглушка, которая не может
 * повести себя неправильно, делает бесполезным весь тест.
 */
function viewShowing(text: string): EditorView {
  const view = {
    state: EditorState.create({ doc: text }),
    dispatch(spec: Parameters<EditorState['update']>[0]) {
      view.state = view.state.update(spec).state;
    },
  };
  return view as unknown as EditorView;
}

describe('содержимое новой вкладки', () => {
  beforeEach(() => {
    tabs.items = [];
    tabs.activeId = null;
    setEditorView(null);
  });

  it('сохраняется, когда представления ещё нет', async () => {
    await createEmpty('текст вкладки');

    expect(activeTab()?.editor.doc.toString()).toBe('текст вкладки');
  });

  it('сохраняется, когда в представлении лежит другая вкладка', async () => {
    setEditorView(viewShowing('содержимое прошлой вкладки'));

    await createEmpty('текст вкладки');

    expect(activeTab()?.editor.doc.toString()).toBe('текст вкладки');
  });

  it('вкладка помечается изменённой: содержимое есть только в памяти', async () => {
    setEditorView(viewShowing('содержимое прошлой вкладки'));

    await createEmpty('текст вкладки');

    expect(activeTab()?.meta.modified).toBe(true);
  });
});
