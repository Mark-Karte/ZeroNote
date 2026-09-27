import { describe, expect, it, vi } from 'vitest';

/**
 * Панель боковой полосы переживает перезапуск (задача 142, находка С12
 * ревизии).
 *
 * Сессия хранит имя панели строкой, восстановление сверяет его со списком
 * известных. До задачи 142 список был свой, отдельно от типа, и «Заметок»
 * (задача 94) в нём не было: панель заметок после перезапуска подменялась
 * деревом.
 */

vi.mock('../src/ipc/roots', () => ({}));
vi.mock('../src/state/tree.svelte', () => ({
  expand: vi.fn(async () => undefined),
  forgetRoot: vi.fn(),
}));

const { PANELS, roots, restoreFromSession } = await import('../src/state/roots.svelte');

describe('панель из сессии', () => {
  it('восстанавливается любая из панелей полосы', async () => {
    for (const panel of PANELS) {
      await restoreFromSession([], true, 0, panel);
      expect(roots.panel).toBe(panel);
    }
    await restoreFromSession([], true, 0, 'notes');
    expect(roots.panel).toBe('notes');
  });

  /** Имя из чужой или будущей версии не оставляет полосу пустой. */
  it('незнакомое имя даёт дерево', async () => {
    await restoreFromSession([], true, 0, 'graph');
    expect(roots.panel).toBe('tree');
  });
});
