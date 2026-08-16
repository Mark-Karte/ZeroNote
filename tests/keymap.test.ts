import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bindingOf, type KeyLike } from '../src/keymap/binding';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function key(code: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { code, key: '', ctrlKey: false, altKey: false, shiftKey: false, ...mods };
}

describe('разбор нажатия', () => {
  /**
   * Главное свойство: сочетание не должно зависеть от раскладки.
   * При русской раскладке клавиша D даёт букву «в», и если брать её из
   * event.key, то Ctrl+D переставал бы работать ровно тогда, когда
   * пользователь набирает русский текст.
   */
  it('не зависит от раскладки клавиатуры', () => {
    // event.key был бы «в», но код клавиши тот же самый.
    expect(bindingOf(key('KeyD', { ctrlKey: true }))).toBe('ctrl+d');
  });

  it('складывает модификаторы в постоянном порядке', () => {
    expect(
      bindingOf(key('KeyD', { ctrlKey: true, altKey: true, shiftKey: true })),
    ).toBe('ctrl+alt+shift+d');
    expect(bindingOf(key('KeyS', { ctrlKey: true, shiftKey: true }))).toBe('ctrl+shift+s');
  });

  it('понимает именованные клавиши', () => {
    expect(bindingOf(key('F5'))).toBe('f5');
    expect(bindingOf(key('ArrowUp', { ctrlKey: true, shiftKey: true }))).toBe(
      'ctrl+shift+up',
    );
    expect(bindingOf(key('Tab', { ctrlKey: true }))).toBe('ctrl+tab');
    expect(bindingOf(key('Escape'))).toBe('escape');
    expect(bindingOf(key('PageDown', { altKey: true }))).toBe('alt+pagedown');
  });

  it('понимает цифры, в том числе на дополнительной клавиатуре', () => {
    expect(bindingOf(key('Digit1', { ctrlKey: true }))).toBe('ctrl+1');
    expect(bindingOf(key('Numpad1', { ctrlKey: true }))).toBe('ctrl+1');
  });

  /** Нажатие одного модификатора сочетанием не является. */
  it('одни модификаторы сочетанием не считает', () => {
    expect(bindingOf(key('ControlLeft', { ctrlKey: true }))).toBeNull();
    expect(bindingOf(key('ShiftRight', { shiftKey: true }))).toBeNull();
    expect(bindingOf(key('AltLeft', { altKey: true }))).toBeNull();
  });

  /**
   * Пустой `code` приходит от экранных клавиатур, программ переназначения
   * и средств специальных возможностей. Отказываться от сочетания в таких
   * случаях нельзя: пользователь нажал ровно то, что хотел.
   */
  it('обходится без кода клавиши, когда его нет', () => {
    expect(bindingOf({ ...key(''), key: 'd', ctrlKey: true })).toBe('ctrl+d');
    expect(bindingOf({ ...key(''), key: 'G', ctrlKey: true })).toBe('ctrl+g');
    expect(bindingOf({ ...key(''), key: 'F5' })).toBe('f5');
    expect(bindingOf({ ...key(''), key: 'ArrowDown', ctrlKey: true, shiftKey: true })).toBe(
      'ctrl+shift+down',
    );
    expect(bindingOf({ ...key(''), key: ' ', ctrlKey: true })).toBe('ctrl+space');
  });

  /**
   * Но запасной путь не должен превращать раскладку в зависимую от языка:
   * кириллическая буква сочетанием не становится.
   */
  it('не подбирает сочетание по кириллической букве', () => {
    expect(bindingOf({ ...key(''), key: 'в', ctrlKey: true })).toBeNull();
  });

  /** Код клавиши главнее: при русской раскладке key отличается, code — нет. */
  it('предпочитает код клавиши букве', () => {
    expect(bindingOf({ ...key('KeyD'), key: 'в', ctrlKey: true })).toBe('ctrl+d');
  });
});

describe('реестр команд', () => {
  /**
   * Канонический список команд задан в Rust: по нему проверяется файл
   * пользователя. Если реестр обработчиков разойдётся с ним, сочетание будет
   * указывать на команду, которую некому выполнить, — и молча ничего не делать.
   */
  it('совпадает со списком в keymap.rs', async () => {
    const rust = readFileSync(join(root, 'src-tauri/src/keymap/mod.rs'), 'utf8');

    // Берём только таблицу COMMANDS, иначе в набор попали бы и умолчания.
    const block = /pub const COMMANDS[^=]*=\s*&\[(.*?)\];/s.exec(rust);
    expect(block, 'таблица COMMANDS не найдена').not.toBeNull();

    const fromRust = new Set(
      [...block![1]!.matchAll(/\(\s*"([a-z.-]+)"\s*,/g)].map((m) => m[1]!),
    );

    const { commandIds } = await import('../src/keymap/registry');
    const fromFront = new Set(commandIds());

    const missingInFront = [...fromRust].filter((id) => !fromFront.has(id)).sort();
    const missingInRust = [...fromFront].filter((id) => !fromRust.has(id)).sort();

    expect(fromRust.size).toBeGreaterThan(0);
    expect(missingInFront, 'есть в keymap.rs, но не в реестре обработчиков').toEqual([]);
    expect(missingInRust, 'есть в реестре обработчиков, но не в keymap.rs').toEqual([]);
  });
});
