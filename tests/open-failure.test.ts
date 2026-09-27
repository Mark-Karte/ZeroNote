import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Отказ открытия не молчит (задача 142, находка С9 ревизии).
 *
 * «Недавнее» на стартовом экране, палитра, обратные ссылки, выдача поиска
 * и переход по ссылке звали `openPath` без обработки ошибки, чаще всего
 * `void`-ом из щелчка: удалённый файл из недавнего, переименованный,
 * запертый другой программой — и не происходило ничего, ни полосы,
 * ни диалога. Ошибка уходила в необработанное обещание.
 */

vi.mock('../src/ipc/files', () => ({
  openFile: vi.fn(),
  reloadBuffer: vi.fn(),
  closeBuffer: vi.fn(),
  newBuffer: vi.fn(),
  restoreSession: vi.fn(),
  setModified: vi.fn(async () => undefined),
}));

vi.mock('../src/ipc/layout', () => ({
  setActiveTab: vi.fn(),
  setActivePane: vi.fn(),
  reorderTab: vi.fn(),
  removeTab: vi.fn(),
  splitPane: vi.fn(),
  closePane: vi.fn(),
  moveTab: vi.fn(),
  setSplitRatio: vi.fn(),
  layoutState: vi.fn(),
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

const ipc = await import('../src/ipc/files');
const { tryOpenPath, tabs } = await import('../src/state/tabs.svelte');
const { notices } = await import('../src/state/notices.svelte');

describe('открытие с отказом', () => {
  beforeEach(() => {
    tabs.items = [];
    notices.items = [];
    vi.clearAllMocks();
  });

  it('говорит об отказе полосой и отвечает «не открылось»', async () => {
    // Так отвечает ядро (`commands::files::open_path`): строкой со строчной.
    vi.mocked(ipc.openFile).mockRejectedValueOnce(
      'не удалось открыть C:\\заметки\\удалённая.md: Не удаётся найти указанный файл.',
    );

    const opened = await tryOpenPath('C:\\заметки\\удалённая.md');

    expect(opened).toBe(false);
    expect(notices.items).toEqual([
      'Не удалось открыть C:\\заметки\\удалённая.md: Не удаётся найти указанный файл.',
    ]);
    expect(tabs.items).toEqual([]);
  });
});

/**
 * Сторож: голый `openPath` — только там, где отказ ловят.
 *
 * `openPath` бросает, и это нужно тем, кто спрашивает сам: окно выбора
 * и брошенные в окно файлы (`actions/files.ts`) отвечают диалогом,
 * лицензии (`actions/about.ts`) — своей фразой. Всем остальным —
 * `tryOpenPath`: новое место открытия, позвавшее голый `openPath`
 * из щелчка, промолчало бы снова.
 */
describe('места открытия', () => {
  it('голый openPath зовут только те, кто ловит отказ сам', () => {
    const src = join(__dirname, '..', 'src');
    const callers = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.(ts|svelte)$/.test(name))
      .filter((name) => /\bopenPath\(/.test(readFileSync(join(src, name), 'utf8')))
      .map((name) => name.split(sep).join('/'))
      .sort();

    expect(callers).toEqual(['actions/about.ts', 'actions/files.ts', 'state/tabs.svelte.ts']);
  });
});
