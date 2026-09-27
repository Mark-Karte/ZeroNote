import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Незаписанный черновик не считается записанным (задача 137, находка Я3).
 *
 * До задачи 137 сброс помечал пачку записанной до ответа ядра. Отказ
 * записи — антивирус придержал временный файл, кончилось место —
 * проглатывался, и следующий сброс не слал тексты, которые с тех пор
 * не менялись: черновик на диске оставался старым или не появлялся вовсе,
 * и после аварии правки пропадали (инвариант 4).
 *
 * Вкладки подменены простыми объектами: проверяется ритм сброса,
 * а не редактор.
 */

vi.mock('../src/ipc/files', () => ({
  flushDrafts: vi.fn(async () => undefined),
  saveSession: vi.fn(async () => undefined),
  dropDraft: vi.fn(async () => undefined),
}));

const fakeTabs = {
  items: [] as {
    meta: { id: number; modified: boolean; path: string | null; large: boolean };
    editor: { text: string } | null;
  }[],
};

vi.mock('../src/state/tabs.svelte', () => ({
  tabs: fakeTabs,
  contentOf: (editor: { text: string }) => editor.text,
  viewStateOf: () => ({}),
  paneViewsOf: () => [],
}));

vi.mock('../src/state/roots.svelte', () => ({
  roots: { sidebar: false, sidebarWidth: 0, panel: 'tree' },
}));

const ipc = await import('../src/ipc/files');
const { flushNow, draftTrouble } = await import('../src/state/persist.svelte');

/**
 * Своя вкладка в каждом тесте: сброс помнит, что уже записано, и тексты
 * прошлого теста иначе считались бы записанными и в следующем.
 */
let run = 0;
let id = 0;
let text = '';

describe('сброс черновиков', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    run += 1;
    id = 100 + run;
    text = `правка ${run}`;
    fakeTabs.items = [
      {
        meta: { id, modified: true, path: 'C:\\a.txt', large: false },
        editor: { text },
      },
    ];
  });

  it('после отказа шлёт тот же черновик снова и говорит об отказе', async () => {
    vi.mocked(ipc.flushDrafts).mockRejectedValueOnce('диск занят');

    await flushNow();
    expect(draftTrouble.problem).toContain('диск занят');

    // Текст с тех пор не менялся — а записать его всё равно надо.
    await flushNow();

    expect(ipc.flushDrafts).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ipc.flushDrafts).mock.calls[1]![0]).toEqual([{ id, text }]);
    // Запись удалась — жалоба снята.
    expect(draftTrouble.problem).toBeNull();
  });

  it('записанное не шлётся повторно', async () => {
    await flushNow();
    await flushNow();

    expect(ipc.flushDrafts).toHaveBeenCalledTimes(1);
  });

  it('снимок сессии пишется и после отказа', async () => {
    vi.mocked(ipc.flushDrafts).mockRejectedValueOnce('диск занят');

    await flushNow();

    expect(ipc.saveSession).toHaveBeenCalled();
  });
});
