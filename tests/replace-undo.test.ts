import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEdits } from '../src/ipc/edits';

/**
 * Отмена замены по проекту не пишет в файлы с несохранёнными правками
 * (задача 138, находка С8 ревизии).
 *
 * Замена такие файлы обходит (Р-138, Р-222): запись под изменённым
 * буфером затёрло бы первое же сохранение. Отмена обходила только
 * до задачи 138 — писала в файл, вкладка спрашивала «Файл изменён
 * снаружи» с умолчанием «Мои правки», и первое же сохранение возвращало
 * заменённый текст: для этого файла отмена тихо не состоялась, хотя
 * строка под полем говорила «отменено».
 */

vi.mock('@tauri-apps/plugin-dialog', () => ({ message: vi.fn(async () => undefined) }));
vi.mock('../src/ipc/edits', () => ({
  applyEdits: vi.fn(async (files: FileEdits[]) => ({ problems: [], undo: files })),
  cancelReplace: vi.fn(),
  planReplace: vi.fn(),
}));
vi.mock('../src/state/modal.svelte', () => ({ askChoice: vi.fn(async () => 'undo') }));
vi.mock('../src/state/persist.svelte', () => ({ noteStructureChange: vi.fn() }));
vi.mock('../src/state/project-search.svelte', () => ({
  projectSearch: { regexp: false, query: '', scope: null },
  runNow: vi.fn(),
}));
vi.mock('../src/state/roots.svelte', () => ({
  roots: { items: [] },
  showPanel: vi.fn(),
  rootLabel: vi.fn(() => ''),
}));
vi.mock('../src/state/tabs.svelte', () => ({ unsavedPaths: vi.fn(() => []) }));
vi.mock('../src/actions/external', () => ({ checkExternalChanges: vi.fn(async () => {}) }));

const edits = await import('../src/ipc/edits');
const dialog = await import('@tauri-apps/plugin-dialog');
const tabs = await import('../src/state/tabs.svelte');
const state = await import('../src/state/replace.svelte');
const { undoReplace } = await import('../src/actions/replace');

function file(path: string): FileEdits {
  return {
    path,
    inside: path.slice(path.lastIndexOf('\\') + 1),
    edits: [{ offset: 0, was: 'bar', becomes: 'foo' }],
  };
}

describe('отмена замены', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` ответов не сбрасывает: занятые файлы прошлого теста
    // иначе достались бы следующему.
    vi.mocked(tabs.unsavedPaths).mockReturnValue([]);
    while (state.takeLastReplace() !== null);
    state.remember({
      query: 'foo',
      replacement: 'bar',
      expression: false,
      matches: 2,
      undo: [file('C:\\проект\\a.txt'), file('C:\\проект\\b.txt')],
    });
  });

  it('обходит файл с несохранёнными правками и оставляет его отмену в стеке', async () => {
    vi.mocked(tabs.unsavedPaths).mockReturnValue(['C:\\проект\\b.txt']);

    await undoReplace();

    expect(edits.applyEdits).toHaveBeenCalledWith([file('C:\\проект\\a.txt')]);
    // Не сделанное — не забыто: сохранив или закрыв файл, отмену можно
    // повторить.
    expect(state.lastReplace()?.undo).toEqual([file('C:\\проект\\b.txt')]);
  });

  it('когда все файлы заняты, ничего не пишет и объясняет почему', async () => {
    vi.mocked(tabs.unsavedPaths).mockReturnValue(['C:\\проект\\a.txt', 'C:\\проект\\b.txt']);

    await undoReplace();

    expect(edits.applyEdits).not.toHaveBeenCalled();
    expect(dialog.message).toHaveBeenCalled();
    expect(state.lastReplace()?.undo).toHaveLength(2);
  });

  it('без занятых файлов отменяет всё, как раньше', async () => {
    await undoReplace();

    expect(edits.applyEdits).toHaveBeenCalledWith([
      file('C:\\проект\\a.txt'),
      file('C:\\проект\\b.txt'),
    ]);
    expect(state.lastReplace()).toBeNull();
  });
});
