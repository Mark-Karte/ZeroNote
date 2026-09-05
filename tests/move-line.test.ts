import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import { moveLineUp, moveLineDown } from '../src/editor/commands';

/**
 * Перемещение строк (Р-142).
 *
 * До задачи 52 реализация была своя и двигала строку **главного** курсора,
 * молча не замечая остальные. При этом `Alt+↑` из набора CodeMirror двигал
 * все выделенные, и два сочетания одного и того же вели себя по-разному.
 * Здесь проверяется именно то, чего своя реализация не умела.
 *
 * Без окна: перемещение — команда над состоянием, и живое приложение
 * ничего не добавило бы к ответу.
 */

type Command = (target: {
  state: EditorState;
  dispatch: (tr: Transaction) => void;
}) => boolean;

function run(state: EditorState, command: Command): EditorState {
  let next = state;
  command({
    state,
    dispatch: (tr: Transaction) => {
      next = tr.state;
    },
  });
  return next;
}

function make(doc: string, ranges: number[][]): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.create(
      ranges.map(([anchor, head]) => EditorSelection.range(anchor!, head ?? anchor!)),
    ),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
}

/** Позиция начала строки с этим текстом — чтобы не считать смещения руками. */
function at(doc: string, text: string): number {
  return doc.indexOf(text);
}

const DOC = 'первая\nвторая\nтретья\nчетвёртая\n';

describe('перемещение одной строки', () => {
  it('вверх меняет её с предыдущей местами', () => {
    const after = run(make(DOC, [[at(DOC, 'третья')]]), moveLineUp);

    expect(after.doc.toString()).toBe('первая\nтретья\nвторая\nчетвёртая\n');
  });

  it('вниз — со следующей', () => {
    const after = run(make(DOC, [[at(DOC, 'вторая')]]), moveLineDown);

    expect(after.doc.toString()).toBe('первая\nтретья\nвторая\nчетвёртая\n');
  });

  /** Курсор едет вместе со строкой, а не остаётся на месте. */
  it('курсор остаётся в своей строке и в том же столбце', () => {
    const cursor = at(DOC, 'третья') + 2;
    const after = run(make(DOC, [[cursor]]), moveLineUp);
    const head = after.selection.main.head;
    const line = after.doc.lineAt(head);

    expect(line.text).toBe('третья');
    expect(head - line.from).toBe(2);
  });

  /**
   * Документ здесь свой, без финального перевода строки: у `DOC` он есть,
   * а значит есть и пятая строка — пустая, — и «вниз» с четвёртой поменяет
   * её местами с этой пустой. Это не край документа, а обычное перемещение.
   */
  it('за края документа не двигает', () => {
    const doc = 'первая\nвторая';

    expect(run(make(doc, [[0]]), moveLineUp).doc.toString()).toBe(doc);
    expect(run(make(doc, [[at(doc, 'вторая')]]), moveLineDown).doc.toString()).toBe(doc);
  });
});

describe('то, чего своя реализация не умела', () => {
  /**
   * Главное свойство замены: два курсора двигают две строки. Прежняя
   * реализация двигала одну и про вторую молчала.
   */
  it('двигает строки всех курсоров сразу', () => {
    const two = [[at(DOC, 'вторая')], [at(DOC, 'четвёртая')]];
    const after = run(make(DOC, two), moveLineUp);

    expect(after.doc.toString()).toBe('вторая\nпервая\nчетвёртая\nтретья\n');
  });

  /** Выделение на несколько строк переезжает целиком, а не одной строкой. */
  it('двигает всё выделение целиком', () => {
    const from = at(DOC, 'первая');
    const to = at(DOC, 'вторая') + 'вторая'.length;
    const after = run(make(DOC, [[from, to]]), moveLineDown);

    expect(after.doc.toString()).toBe('третья\nпервая\nвторая\nчетвёртая\n');
  });

  /** Выделение остаётся на своём тексте, а не схлопывается в курсор. */
  it('сохраняет выделение после перемещения', () => {
    const from = at(DOC, 'вторая');
    const to = from + 'вторая'.length;
    const after = run(make(DOC, [[from, to]]), moveLineDown);
    const { main } = after.selection;

    expect(after.doc.sliceString(main.from, main.to)).toBe('вторая');
  });

  /** Одна правка — один шаг отмены, как и было у своей реализации. */
  it('остаётся одним шагом отмены', () => {
    const state = make(DOC, [[at(DOC, 'вторая')], [at(DOC, 'четвёртая')]]);
    let changes = 0;
    moveLineUp({
      state,
      dispatch: () => {
        changes += 1;
      },
    });

    expect(changes).toBe(1);
  });
});
