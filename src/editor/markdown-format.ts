import type { ChangeSpec, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Разметка markdown: обёртки, префиксы строк, ссылки и заготовки.
 *
 * Всё написано своими руками поверх `EditorState` и вынесено сюда чистыми
 * функциями — панель форматирования и палитра зовут одно и то же, а проверить
 * это можно без запуска приложения.
 *
 * Главное свойство всех команд — **переключение**, а не вставка. Нажать
 * «жирный» на уже жирном тексте означает снять жирный, а не завернуть его
 * во второй слой звёздочек. Иначе панель портит текст ровно так же, как
 * автоформатирование, которого мы не делаем (инвариант 1).
 *
 * Работают со всеми выделениями сразу: множественные курсоры включены,
 * и операция, применяющаяся только к первому, выглядела бы поломкой.
 */

/** Что вставляет заготовка. Блоками, потому что таблицу в строку не написать. */
export const SNIPPETS: Record<string, string> = {
  table: '| Столбец | Столбец |\n| --- | --- |\n|  |  |',
  'code-block': '```\n\n```',
  divider: '---',
};

/**
 * Правка и то, куда встанет курсор. `null` — делать нечего.
 *
 * Курсор описан парой чисел, а не `EditorSelection`: диспетчеру этого
 * достаточно, а функции остаются чистыми — их можно позвать, не собирая
 * представление редактора.
 */
export type Edit = {
  changes: ChangeSpec[];
  selection?: { anchor: number; head?: number };
} | null;

/**
 * Обёртка вокруг выделения: `**жирный**`, `*курсив*`, `==выделение==`.
 *
 * Три случая, и все три встречаются каждый день:
 *
 * * выделен текст, вокруг него уже стоят знаки — снимаем их;
 * * выделен текст без знаков — заворачиваем;
 * * выделения нет — берём слово под курсором, а если его нет, ставим пару
 *   знаков и оставляем курсор между ними.
 */
export function toggleWrap(state: EditorState, marker: string): Edit {
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  let cursor: number | null = null;

  for (const range of state.selection.ranges) {
    let { from, to } = range;

    if (from === to) {
      const word = state.wordAt(from);
      if (word) {
        from = word.from;
        to = word.to;
      } else {
        // Пустое место: ставим пару и садимся между знаками.
        changes.push({ from, insert: marker + marker });
        cursor = from + marker.length;
        continue;
      }
    }

    const before = doc.sliceString(Math.max(0, from - marker.length), from);
    const after = doc.sliceString(to, Math.min(doc.length, to + marker.length));

    if (before === marker && after === marker) {
      // Знаки снаружи выделения — самый частый случай: выделили слово
      // двойным щелчком, а звёздочки остались за границей.
      changes.push({ from: from - marker.length, to: from });
      changes.push({ from: to, to: to + marker.length });
      continue;
    }

    const text = doc.sliceString(from, to);
    if (
      text.length >= marker.length * 2 &&
      text.startsWith(marker) &&
      text.endsWith(marker)
    ) {
      // Знаки внутри выделения: выделили вместе со звёздочками.
      changes.push({ from, to: from + marker.length });
      changes.push({ from: to - marker.length, to });
      continue;
    }

    changes.push({ from, insert: marker });
    changes.push({ from: to, insert: marker });
  }

  if (changes.length === 0) return null;
  return cursor === null
    ? { changes }
    : { changes, selection: { anchor: cursor } };
}

/** Строки, задетые выделениями, без повторов и по порядку. */
function touchedLines(state: EditorState): { from: number; text: string }[] {
  const doc = state.doc;
  const lines: { from: number; text: string }[] = [];

  for (const range of state.selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;

    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      if (lines.length > 0 && lines[lines.length - 1]!.from === line.from) continue;
      lines.push({ from: line.from, text: line.text });
    }
  }

  return lines;
}

/** Отступ в начале строки — префикс ставится после него, а не перед. */
function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}

/**
 * Префикс строки: `- `, `> `, `- [ ] `.
 *
 * Решение «ставить или снимать» принимается один раз на всё выделение,
 * по большинству: если префикс есть у всех задетых строк — снимаем, иначе
 * ставим. Построчное решение превратило бы список в чересполосицу.
 */
export function togglePrefix(state: EditorState, prefix: string): Edit {
  const lines = touchedLines(state);
  if (lines.length === 0) return null;

  const has = (text: string): boolean => text.slice(indentOf(text)).startsWith(prefix);
  const removing = lines.every((line) => has(line.text));

  const changes: ChangeSpec[] = lines.map((line) => {
    const at = line.from + indentOf(line.text);
    return removing
      ? { from: at, to: at + prefix.length }
      : { from: at, insert: prefix };
  });

  return { changes };
}

/** Строка уже размечена как список задач — `- [ ]` или `- [x]`. */
const TASK = /^- \[[ xX]\] /;
/** Нумерованный пункт: `1. `, `12. `. */
const ORDERED = /^\d+\. /;
/** Заголовок: решётки и пробел за ними. */
const HEADING = /^(#{1,6}) /;

/**
 * Список задач. Отдельно от обычного префикса: снимать надо и `- [ ]`,
 * и `- [x]`, а ставить всегда пустую.
 */
export function toggleTask(state: EditorState): Edit {
  const lines = touchedLines(state);
  if (lines.length === 0) return null;

  const marked = (text: string): RegExpExecArray | null =>
    TASK.exec(text.slice(indentOf(text)));
  const removing = lines.every((line) => marked(line.text) !== null);

  const changes: ChangeSpec[] = lines.map((line) => {
    const at = line.from + indentOf(line.text);
    const found = marked(line.text);
    if (removing && found) return { from: at, to: at + found[0].length };
    // Уже маркированный пункт превращаем в задачу, а не дописываем к нему.
    const bullet = line.text.slice(indentOf(line.text)).startsWith('- ') ? 2 : 0;
    return { from: at, to: at + bullet, insert: '- [ ] ' };
  });

  return { changes };
}

/**
 * Нумерованный список. Номера считаются подряд с единицы: писать `1.` во всех
 * строках markdown разрешает, но человек, открывший файл, увидит там столбец
 * единиц и решит, что это ошибка.
 */
export function toggleOrdered(state: EditorState): Edit {
  const lines = touchedLines(state);
  if (lines.length === 0) return null;

  const removing = lines.every((line) =>
    ORDERED.test(line.text.slice(indentOf(line.text))),
  );

  const changes: ChangeSpec[] = lines.map((line, index) => {
    const at = line.from + indentOf(line.text);
    const found = ORDERED.exec(line.text.slice(indentOf(line.text)));
    if (removing && found) return { from: at, to: at + found[0].length };
    return { from: at, to: at + (found ? found[0].length : 0), insert: `${index + 1}. ` };
  });

  return { changes };
}

/**
 * Заголовок заданного уровня.
 *
 * Тот же уровень снимается, другой — заменяется. Заголовок второго уровня,
 * нажатый на заголовке первого, должен стать вторым, а не получить решётку
 * в довесок.
 */
export function toggleHeading(state: EditorState, level: number): Edit {
  const lines = touchedLines(state);
  if (lines.length === 0) return null;

  const changes: ChangeSpec[] = lines.map((line) => {
    const found = HEADING.exec(line.text);
    const width = found ? found[0].length : 0;

    if (found && found[1]!.length === level) {
      return { from: line.from, to: line.from + width };
    }
    return { from: line.from, to: line.from + width, insert: `${'#'.repeat(level)} ` };
  });

  return { changes };
}

/**
 * Ссылка `[текст](адрес)`.
 *
 * Курсор встаёт туда, где всё равно придётся печатать: между круглыми
 * скобками, если текст выделен, и между квадратными, если нет.
 */
export function insertLink(state: EditorState): Edit {
  const range = state.selection.main;
  const text = state.doc.sliceString(range.from, range.to);

  if (text === '') {
    return {
      changes: [{ from: range.from, insert: '[]()' }],
      selection: { anchor: range.from + 1 },
    };
  }

  return {
    changes: [{ from: range.from, to: range.to, insert: `[${text}]()` }],
    selection: { anchor: range.from + text.length + 3 },
  };
}

/**
 * Заготовка блоком.
 *
 * Встаёт со своей строки: таблица, дописанная в конец абзаца, таблицей
 * не является. Пустая строка перед ней добавляется, только если её там нет.
 */
export function insertBlock(state: EditorState, block: string): Edit {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const alone = line.text.trim() === '';

  const insert = alone ? block : `\n${block}`;
  const at = alone ? line.from : line.to;

  return {
    changes: [{ from: at, to: alone ? line.to : at, insert }],
    // Курсор — в начало вставленного: в таблице и в блоке кода править
    // начинают с первой строки.
    selection: { anchor: at + (alone ? 0 : 1) },
  };
}

/** Превратить правку в команду редактора. */
export function asCommand(make: (state: EditorState) => Edit) {
  return (view: EditorView): boolean => {
    const edit = make(view.state);
    if (!edit) return false;

    view.dispatch({
      changes: edit.changes,
      selection: edit.selection,
      scrollIntoView: true,
      userEvent: 'input.format',
    });
    view.focus();
    return true;
  };
}
