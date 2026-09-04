import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';

import {
  insertBlock,
  insertLink,
  toggleHeading,
  toggleOrdered,
  togglePrefix,
  toggleTask,
  toggleWrap,
  type Edit,
} from '../src/editor/markdown-format';

/**
 * Разметка markdown. Главное свойство — переключение: нажатое второй раз
 * снимает то, что поставило первое. Иначе панель форматирования портит текст
 * ровно так же, как автоформатирование, которого мы не делаем (инвариант 1).
 */

function state(doc: string, from: number, to = from): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.single(from, to) });
}

/** Применить правку и вернуть текст с курсором, помеченным `|`. */
function apply(before: EditorState, edit: Edit): string {
  if (!edit) return `${before.doc.toString()} (без изменений)`;

  const tr = before.update({ changes: edit.changes, selection: edit.selection });
  const doc = tr.state.doc.toString();
  const at = tr.state.selection.main.head;
  return doc.slice(0, at) + '|' + doc.slice(at);
}

describe('обёртки', () => {
  it('заворачивают выделенное', () => {
    const before = state('слово', 0, 5);
    expect(apply(before, toggleWrap(before, '**')).replace('|', '')).toBe('**слово**');
  });

  /** Самый частый случай: выделили слово двойным щелчком, знаки снаружи. */
  it('снимают знаки, стоящие снаружи выделения', () => {
    const before = state('**слово**', 2, 7);
    const after = apply(before, toggleWrap(before, '**'));

    expect(after.replace('|', '')).toBe('слово');
  });

  it('снимают знаки, попавшие внутрь выделения', () => {
    const before = state('**слово**', 0, 9);
    const after = apply(before, toggleWrap(before, '**'));

    expect(after.replace('|', '')).toBe('слово');
  });

  it('без выделения берут слово под курсором', () => {
    const before = state('одно слово тут', 7);
    const after = apply(before, toggleWrap(before, '*'));

    expect(after.replace('|', '')).toBe('одно *слово* тут');
  });

  /** На пустом месте ставим пару знаков и садимся между ними. */
  it('на пустом месте оставляют курсор между знаками', () => {
    const before = state('', 0);
    expect(apply(before, toggleWrap(before, '=='))).toBe('==|==');
  });

  it('работают с любым знаком, а не только со звёздочкой', () => {
    const before = state('текст', 0, 5);
    const bare = (marker: string): string =>
      apply(before, toggleWrap(before, marker)).replace('|', '');

    expect(bare('==')).toBe('==текст==');
    expect(bare('~~')).toBe('~~текст~~');
    expect(bare('`')).toBe('`текст`');
  });
});

describe('префиксы строк', () => {
  it('ставятся на все задетые строки разом', () => {
    const before = state('раз\nдва\nтри', 0, 11);
    const after = apply(before, togglePrefix(before, '- '));

    expect(after.replace('|', '')).toBe('- раз\n- два\n- три');
  });

  /** Решение принимается по большинству: иначе список стал бы чересполосицей. */
  it('снимаются, только когда они есть у всех строк', () => {
    const mixed = state('- раз\nдва', 0, 9);
    expect(apply(mixed, togglePrefix(mixed, '- ')).replace('|', '')).toBe(
      '- - раз\n- два',
    );

    const all = state('- раз\n- два', 0, 11);
    expect(apply(all, togglePrefix(all, '- ')).replace('|', '')).toBe('раз\nдва');
  });

  it('встают после отступа, а не перед ним', () => {
    const before = state('    вложенное', 4);
    expect(apply(before, togglePrefix(before, '> ')).replace('|', '')).toBe(
      '    > вложенное',
    );
  });
});

describe('список задач', () => {
  it('снимается и с пустой, и с отмеченной задачи', () => {
    const empty = state('- [ ] дело', 0);
    expect(apply(empty, toggleTask(empty)).replace('|', '')).toBe('дело');

    const done = state('- [x] дело', 0);
    expect(apply(done, toggleTask(done)).replace('|', '')).toBe('дело');
  });

  /** Обычный пункт превращается в задачу, а не обрастает вторым маркером. */
  it('превращает маркированный пункт в задачу', () => {
    const before = state('- дело', 0);
    expect(apply(before, toggleTask(before)).replace('|', '')).toBe('- [ ] дело');
  });
});

describe('нумерованный список', () => {
  it('нумерует подряд с единицы', () => {
    const before = state('раз\nдва\nтри', 0, 11);
    expect(apply(before, toggleOrdered(before)).replace('|', '')).toBe(
      '1. раз\n2. два\n3. три',
    );
  });

  it('снимается целиком', () => {
    const before = state('1. раз\n2. два', 0, 13);
    expect(apply(before, toggleOrdered(before)).replace('|', '')).toBe('раз\nдва');
  });

  /**
   * Нумерованный целиком список снимается, а не перенумеровывается: команда
   * называется «нумерованный список», и нажатая на нём второй раз она обязана
   * его убрать. Перенумерование — другая команда, и её у нас нет.
   */
  it('снимается, даже когда номера не по порядку', () => {
    const before = state('5. раз\n9. два', 0, 13);
    expect(apply(before, toggleOrdered(before)).replace('|', '')).toBe('раз\nдва');
  });

  /** А вот когда список только собирается, чужие номера переписываются. */
  it('переписывает номера у тех строк, где они уже были', () => {
    const before = state('5. раз\nдва', 0, 10);
    expect(apply(before, toggleOrdered(before)).replace('|', '')).toBe(
      '1. раз\n2. два',
    );
  });
});

describe('заголовки', () => {
  it('тот же уровень снимается', () => {
    const before = state('## Раздел', 0);
    expect(apply(before, toggleHeading(before, 2)).replace('|', '')).toBe('Раздел');
  });

  /** Другой уровень заменяется, а не дописывается решёткой. */
  it('другой уровень заменяет прежний', () => {
    const before = state('# Раздел', 0);
    expect(apply(before, toggleHeading(before, 3)).replace('|', '')).toBe('### Раздел');
  });

  it('ставится на обычную строку', () => {
    const before = state('Раздел', 0);
    expect(apply(before, toggleHeading(before, 1)).replace('|', '')).toBe('# Раздел');
  });
});

describe('ссылка', () => {
  it('оборачивает выделенное и садит курсор в скобки адреса', () => {
    const before = state('текст', 0, 5);
    expect(apply(before, insertLink(before))).toBe('[текст](|)');
  });

  it('без выделения садит курсор в квадратные скобки', () => {
    const before = state('', 0);
    expect(apply(before, insertLink(before))).toBe('[|]()');
  });
});

describe('заготовки', () => {
  /** Таблица, дописанная в конец абзаца, таблицей не является. */
  it('встают со своей строки', () => {
    const before = state('абзац', 5);
    const after = apply(before, insertBlock(before, '---'));

    expect(after.replace('|', '')).toBe('абзац\n---');
  });

  it('на пустой строке не добавляют лишнего перевода', () => {
    const before = state('', 0);
    expect(apply(before, insertBlock(before, '---')).replace('|', '')).toBe('---');
  });
});
