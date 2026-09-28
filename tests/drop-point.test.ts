import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';

import { dropPoint, dropPoints, hold, release, setHover } from '../src/editor/drop-point';

/**
 * Точка броска файла (задача 147). Место вставки держится, пока файлы
 * копируются, — и едет вместе с правками, сделанными за это время:
 * ссылка обязана лечь туда, куда бросили, а не на прежнее число знаков.
 */

const start = (): EditorState => EditorState.create({ doc: 'первая строка\nвторая', extensions: dropPoint() });

describe('точка броска', () => {
  it('место едет вместе с правками до него и стоит при правках после', () => {
    let state = start().update({ effects: hold.of({ id: 1, pos: 14 }) }).state;
    state = state.update({ changes: { from: 0, insert: 'ещё ' } }).state;
    expect(dropPoints(state)?.pending).toEqual([{ id: 1, pos: 18 }]);

    state = state.update({ changes: { from: state.doc.length, insert: ' конец' } }).state;
    expect(dropPoints(state)?.pending).toEqual([{ id: 1, pos: 18 }]);

    state = state.update({ effects: release.of(1) }).state;
    expect(dropPoints(state)?.pending).toEqual([]);
  });

  it('два броска подряд держат каждый своё место', () => {
    let state = start().update({ effects: [hold.of({ id: 1, pos: 0 }), hold.of({ id: 2, pos: 5 })] }).state;
    state = state.update({ effects: release.of(1) }).state;
    expect(dropPoints(state)?.pending).toEqual([{ id: 2, pos: 5 }]);
  });

  it('точка под указателем не выходит за текст и убирается', () => {
    let state = start().update({ effects: setHover.of(1000) }).state;
    expect(dropPoints(state)?.hover).toBe(state.doc.length);
    state = state.update({ effects: setHover.of(null) }).state;
    expect(dropPoints(state)?.hover).toBe(null);
  });
});
