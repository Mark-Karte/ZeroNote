import { describe, expect, it } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { history, undo, undoDepth, undoSelection } from '@codemirror/commands';
import { createMirror, mirroredFrom, replaySpec, sourceOf } from '../src/editor/mirror';
import { bookmarkField, bookmarks, toggleBookmarkEffect } from '../src/editor/bookmarks';

/**
 * Зеркала (Р-209): один буфер в нескольких областях.
 *
 * Проверяется устройство, записанное до кода: у зеркала пустая история,
 * правки ходят в обе стороны, а отмена считается на главном состоянии
 * и доезжает до зеркала как обычная правка.
 */

/**
 * Цель для команд CodeMirror без представления: состояние и куда слать.
 * Последняя транзакция запоминается — её и несут в другое состояние.
 */
function headless(state: EditorState) {
  const target = {
    state,
    last: null as Transaction | null,
    dispatch(tr: Transaction) {
      target.state = tr.state;
      target.last = tr;
    },
  };
  return target;
}

const base = [history(), bookmarks([])];

describe('зеркало', () => {
  it('делит документ и выделение с главным', () => {
    const primary = EditorState.create({ doc: 'абв', selection: { anchor: 2 }, extensions: base });
    const mirror = createMirror(primary, base);

    expect(mirror.doc).toBe(primary.doc);
    expect(mirror.selection.main.head).toBe(2);
  });

  it('не ведёт историю, даже когда в нём набирают', () => {
    const primary = EditorState.create({ doc: '', extensions: base });
    const mirror = createMirror(primary, base);

    const typed = mirror.update({ changes: { from: 0, insert: 'текст' } }).state;

    expect(typed.doc.toString()).toBe('текст');
    expect(undoDepth(typed)).toBe(0);
    // А главное — ведёт: иначе проверка выше ничего не значила бы.
    const inPrimary = primary.update({ changes: { from: 0, insert: 'текст' } }).state;
    expect(undoDepth(inPrimary)).toBe(1);
  });
});

describe('перенос транзакции', () => {
  it('несёт изменения текста и помечает источник', () => {
    const state = EditorState.create({ doc: 'ab', extensions: base });
    const tr = state.update({ changes: { from: 1, insert: 'X' }, userEvent: 'input.type' });

    const spec = replaySpec(tr, 7);

    expect(spec).not.toBeNull();
    const applied = createMirror(state, base).update(spec!);
    expect(applied.state.doc.toString()).toBe('aXb');
    expect(sourceOf(applied)).toBe(7);
    expect(applied.annotation(Transaction.userEvent)).toBe('input.type');
  });

  it('движение курсора не несёт', () => {
    const state = EditorState.create({ doc: 'ab', extensions: base });
    const tr = state.update({ selection: { anchor: 1 } });

    expect(replaySpec(tr, 1)).toBeNull();
  });

  it('несёт закладку: она свойство буфера, а не области', () => {
    const state = EditorState.create({ doc: 'a\nb', extensions: base });
    const line = state.doc.line(2).from;
    const tr = state.update({ effects: toggleBookmarkEffect.of(line) });

    const spec = replaySpec(tr, 1);
    const mirror = createMirror(state, base).update(spec!).state;

    expect(mirror.field(bookmarkField).size).toBe(1);
  });

  it('прямой ввод не помечен источником, рассылка помечена', () => {
    const state = EditorState.create({ doc: '', extensions: base });
    const direct = state.update({ changes: { from: 0, insert: 'a' } });
    expect(sourceOf(direct)).toBeNull();

    const forwarded = state.update({
      changes: { from: 0, insert: 'a' },
      annotations: mirroredFrom.of(3),
    });
    expect(sourceOf(forwarded)).toBe(3);
  });
});

describe('история курсора у зеркала своя (задача 98)', () => {
  /**
   * Курсор у зеркала свой (Р-209), значит и «вернуть его туда, где он был» —
   * своё. Перенаправить команду в главное нельзя: она подвинула бы курсор
   * в другой области.
   */
  it('движение курсора попадает в историю зеркала', () => {
    const primary = EditorState.create({ doc: 'начало и конец', extensions: base });
    const mirror = headless(createMirror(primary, base));

    mirror.dispatch(mirror.state.update({ selection: { anchor: 3 } }));
    mirror.dispatch(mirror.state.update({ selection: { anchor: 12 } }));

    expect(mirror.state.selection.main.head).toBe(12);
    expect(undoSelection(mirror)).toBe(true);
    expect(mirror.state.selection.main.head).toBe(3);
  });

  /**
   * А правка в историю зеркала не попадает по-прежнему: две истории текста
   * на один документ — то, ради чего история зеркала и была отключена.
   */
  it('но правка в неё по-прежнему не попадает', () => {
    const primary = EditorState.create({ doc: '', extensions: base });
    const mirror = createMirror(primary, base);

    const typed = mirror.update({ changes: { from: 0, insert: 'текст' } }).state;
    expect(undoDepth(typed)).toBe(0);

    // И рассылка правки из главного — тоже правка: её зеркало не помнит.
    const replayed = typed.update({ changes: { from: 5, insert: '!' } }).state;
    expect(undoDepth(replayed)).toBe(0);
  });
});

describe('отмена идёт через главное состояние', () => {
  it('набранное в зеркале отменяется в главном и возвращается в зеркало', () => {
    const primary = headless(EditorState.create({ doc: 'начало', extensions: base }));
    const mirror = headless(createMirror(primary.state, base));

    // Набрали в зеркале — правка уехала в главное с пометкой источника.
    const typed = mirror.state.update({ changes: { from: 6, insert: ' и конец' } });
    mirror.dispatch(typed);
    primary.dispatch(primary.state.update(replaySpec(typed, 2)!));

    expect(primary.state.doc.toString()).toBe('начало и конец');
    expect(undoDepth(primary.state)).toBe(1);
    expect(undoDepth(mirror.state)).toBe(0);

    // Отмена — на главном; результат разослан зеркалу как обычная правка.
    expect(undo(primary)).toBe(true);
    const back = replaySpec(primary.last!, 1);
    mirror.dispatch(mirror.state.update(back!));

    expect(primary.state.doc.toString()).toBe('начало');
    expect(mirror.state.doc.toString()).toBe('начало');
    // У зеркала истории нет и после рассылки.
    expect(undoDepth(mirror.state)).toBe(0);
  });
});
