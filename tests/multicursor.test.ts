import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from '@codemirror/state';
import { selectNextOccurrence } from '@codemirror/search';

/**
 * Мультикурсор взят у CodeMirror целиком, и проверяется здесь именно наше
 * применение: что команда работает при нашем наборе расширений и что без
 * `allowMultipleSelections` она молча схлопывает выделения в одно.
 *
 * Проверяется без окна: `selectNextOccurrence` — команда над состоянием,
 * а не над представлением, и это как раз тот случай, когда живое приложение
 * ничего не добавляет к ответу.
 */

/** Выполнить команду над состоянием и вернуть получившееся состояние. */
function run(state: EditorState): EditorState {
  let next = state;
  selectNextOccurrence({
    state,
    dispatch: (tr: Transaction) => {
      next = tr.state;
    },
  });
  return next;
}

const DOC = 'CACHE = 1\nvalue = 2\nCACHE = 3\nCACHE = 4\n';

function fresh(multiple = true): EditorState {
  return EditorState.create({
    doc: DOC,
    selection: { anchor: 0 },
    extensions: multiple ? [EditorState.allowMultipleSelections.of(true)] : [],
  });
}

describe('курсор на следующее совпадение', () => {
  it('первое нажатие выделяет слово под курсором', () => {
    const after = run(fresh());

    expect(after.selection.ranges.length).toBe(1);
    expect(after.sliceDoc(after.selection.main.from, after.selection.main.to)).toBe('CACHE');
  });

  it('следующие нажатия добавляют курсоры', () => {
    let state = run(fresh());
    state = run(state);
    expect(state.selection.ranges.length).toBe(2);

    state = run(state);
    expect(state.selection.ranges.length).toBe(3);

    // Все выделения — то же слово, а не что попало.
    for (const range of state.selection.ranges) {
      expect(state.sliceDoc(range.from, range.to)).toBe('CACHE');
    }
  });

  it('дойдя до конца, идёт по кругу и больше не растёт', () => {
    let state = fresh();
    for (let i = 0; i < 6; i += 1) state = run(state);

    // Вхождений три; седьмое нажатие взять неоткуда.
    expect(state.selection.ranges.length).toBe(3);
  });

  it('без allowMultipleSelections курсоры не набираются', () => {
    // Ради этого разрешение и стоит в наборе расширений. Забыв его, мы бы
    // получили команду, которая «работает», но каждый раз оставляет один
    // курсор, — и искали бы причину в самой команде.
    let state = run(fresh(false));
    state = run(state);

    expect(state.selection.ranges.length).toBe(1);
  });
});
