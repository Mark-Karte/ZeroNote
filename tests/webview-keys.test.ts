import { describe, expect, it, vi } from 'vitest';

/**
 * Сочетания, которыми вебвью перезагружает страницу, отняты у него
 * (задача 136, находка С11 ревизии).
 *
 * Перезагрузка страницы посреди работы поднимает фронтенд заново:
 * пропадают правки последних двух секунд, ещё не ушедшие в черновик,
 * и история отмены всех вкладок. `F5` и `Ctrl+R` были отняты с этапа 1,
 * а `Ctrl+F5` («запуск без отладки» в VS Code) и `Shift+F5` — нет.
 *
 * Проверяется настоящий диспетчер: окно подменено простым `EventTarget`,
 * нажатие — событием с теми же полями, что у настоящего.
 */

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../src/ipc/keymap', () => ({ keymapState: vi.fn() }));
// Команды не нужны: проверяются сочетания, которые ни одной не заняты.
vi.mock('../src/keymap/registry', () => ({ COMMANDS: {} }));

(globalThis as { window?: unknown }).window = new EventTarget();

const { installGlobalKeymap } = await import('../src/keymap/global.svelte');
installGlobalKeymap(() => {});

/** Нажать клавишу и узнать, отнял ли её диспетчер у вебвью. */
function taken(code: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}): boolean {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, {
    code,
    key: code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('перезагрузка страницы', () => {
  it('F5 и Ctrl+R — как и раньше', () => {
    expect(taken('F5')).toBe(true);
    expect(taken('KeyR', { ctrlKey: true })).toBe(true);
    expect(taken('KeyR', { ctrlKey: true, shiftKey: true })).toBe(true);
  });

  it('Ctrl+F5, Shift+F5 и Ctrl+Shift+F5', () => {
    expect(taken('F5', { ctrlKey: true })).toBe(true);
    expect(taken('F5', { shiftKey: true })).toBe(true);
    expect(taken('F5', { ctrlKey: true, shiftKey: true })).toBe(true);
  });

  it('свободная клавиша вебвью достаётся', () => {
    expect(taken('F6')).toBe(false);
  });
});
