import { describe, expect, it } from 'vitest';

import { chordVerdict, conflictFor, conflictQuestion } from '../src/keymap/conflicts';

/**
 * Редактор клавиш обязан назвать вслух то, что отнимает. Молча занятое
 * сочетание — это сломанная команда, о которой человек узнает через неделю
 * и не свяжет одно с другим.
 */

const BINDINGS: Record<string, string> = {
  'ctrl+s': 'file.save',
  'ctrl+shift+s': 'file.save-all',
  'ctrl+c': 'edit.copy',
};

const TITLES = new Map([
  ['file.save', 'Сохранить'],
  ['file.save-all', 'Сохранить всё'],
  ['edit.copy', 'Копировать'],
]);

describe('занятость сочетания', () => {
  it('свободное сочетание никем не занято', () => {
    expect(conflictFor('ctrl+alt+q', 'file.open', BINDINGS, TITLES)).toBeNull();
  });

  it('называет команду, у которой отнимают', () => {
    expect(conflictFor('ctrl+s', 'file.open', BINDINGS, TITLES)).toEqual({
      kind: 'command',
      what: 'Сохранить',
    });
  });

  /**
   * Назначить команде то, что у неё и так есть, — не столкновение, а ничего.
   * Иначе редактор спрашивал бы «отнять у самой себя?».
   */
  it('своё же сочетание столкновением не считает', () => {
    expect(conflictFor('ctrl+s', 'file.save', BINDINGS, TITLES)).toBeNull();
  });

  /**
   * Сочетания редактора в раскладке не значатся — их приносит CodeMirror
   * (Р-122). Обычная проверка на занятость их не видит, а наш диспетчер
   * стоит на перехвате и отнимет их молча.
   */
  it('видит сочетания, которые приносит сам редактор', () => {
    expect(conflictFor('alt+up', 'file.open', BINDINGS, TITLES)).toEqual({
      kind: 'editor',
      what: 'переместить строку вверх',
    });
    expect(conflictFor('escape', 'file.open', BINDINGS, TITLES)?.kind).toBe('editor');
  });

  /**
   * Буфер обмена мы намеренно не перехватываем (Р-108), но перехват включится,
   * как только сочетание займёт другая команда.
   */
  it('предупреждает про буфер обмена', () => {
    const conflict = conflictFor('ctrl+c', 'file.open', BINDINGS, TITLES);
    // Сочетание есть и в раскладке, поэтому первым назовётся владелец —
    // это точнее: у команды «Копировать» и правда отнимут её сочетание.
    expect(conflict).toEqual({ kind: 'command', what: 'Копировать' });
  });

  it('вопрос всегда называет и сочетание, и потерю', () => {
    const chord = 'Ctrl S';
    const question = conflictQuestion({ kind: 'command', what: 'Сохранить' }, chord);

    expect(question).toContain(chord);
    expect(question).toContain('Сохранить');
  });

  it('вопрос про редактор объясняет, почему сочетания нет в списке', () => {
    const question = conflictQuestion(
      { kind: 'editor', what: 'переместить строку вверх' },
      'Alt ↑',
    );

    expect(question).toContain('Alt ↑');
    expect(question).toContain('редактор');
  });
});

/**
 * Что делать с нажатием, пойманным при назначении (С7 ревизии).
 *
 * До задачи 142 назначалось любое нажатие, кроме Esc: Enter «по привычке
 * ок» записывал `enter` = «Закрыть вкладку», и Enter в любом тексте
 * закрывал вкладку вместо новой строки. Столкновения при этом не было —
 * проверка знает только занятые сочетания, а клавиши набора никто
 * не занимает.
 */
describe('годится ли нажатие для назначения', () => {
  it('Esc отменяет назначение', () => {
    expect(chordVerdict('escape')).toBe('cancel');
  });

  it('голая клавиша набора и движения по тексту не назначается', () => {
    for (const binding of [
      'enter',
      'space',
      'tab',
      'a',
      '7',
      'comma',
      'backspace',
      'delete',
      'down',
      'home',
      'pagedown',
    ]) {
      expect(chordVerdict(binding), binding).toBe('typing');
    }
  });

  it('с одним Shift — тоже: это заглавная буква и выделение', () => {
    for (const binding of ['shift+a', 'shift+enter', 'shift+tab', 'shift+left', 'shift+end']) {
      expect(chordVerdict(binding), binding).toBe('typing');
    }
  });

  /** F-клавиши без модификаторов стоят и в умолчаниях: F3, Shift+F2, F12. */
  it('F-клавиши и сочетания с Ctrl или Alt назначаются', () => {
    for (const binding of ['f6', 'shift+f3', 'ctrl+k', 'alt+left', 'ctrl+enter', 'insert']) {
      expect(chordVerdict(binding), binding).toBe('take');
    }
  });
});
