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
  // Схема рисуется в Obsidian, у нас — блоком кода с подписью языка.
  // Заготовка — самая короткая годная схема, а не пустой блок: пустой
  // `mermaid` в Obsidian показывает ошибку разбора.
  mermaid: '```mermaid\nflowchart LR\n    A --> B\n```',
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
 * Обёртка вокруг выделения: `**жирный**`, `*курсив*`, `==выделение==`,
 * а с задачи 102 и несимметричные — `<u>подчёркнутый</u>`, `[[ссылка]]`.
 *
 * Три случая, и все три встречаются каждый день:
 *
 * * выделен текст, вокруг него уже стоят знаки — снимаем их;
 * * выделен текст без знаков — заворачиваем;
 * * выделения нет — берём слово под курсором, а если его нет, ставим пару
 *   знаков и оставляем курсор между ними.
 */
export function toggleWrap(state: EditorState, open: string, close: string = open): Edit {
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
        changes.push({ from, insert: open + close });
        cursor = from + open.length;
        continue;
      }
    }

    const before = doc.sliceString(Math.max(0, from - open.length), from);
    const after = doc.sliceString(to, Math.min(doc.length, to + close.length));

    if (before === open && after === close) {
      // Знаки снаружи выделения — самый частый случай: выделили слово
      // двойным щелчком, а звёздочки остались за границей.
      changes.push({ from: from - open.length, to: from });
      changes.push({ from: to, to: to + close.length });
      continue;
    }

    const text = doc.sliceString(from, to);
    if (
      text.length >= open.length + close.length &&
      text.startsWith(open) &&
      text.endsWith(close)
    ) {
      // Знаки внутри выделения: выделили вместе со звёздочками.
      changes.push({ from, to: from + open.length });
      changes.push({ from: to - close.length, to });
      continue;
    }

    changes.push({ from, insert: open });
    changes.push({ from: to, insert: close });
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
 * Картинка `![подпись](путь)`.
 *
 * Курсор встаёт в круглые скобки всегда: у картинки главное — путь,
 * подпись необязательна. Выделенный текст становится подписью.
 * Встроить картинку по имени — `![[рисунок.png]]` — удобнее подсказкой
 * после `![[` (Р-218), и у неё своя команда не нужна.
 */
export function insertImage(state: EditorState): Edit {
  const range = state.selection.main;
  const text = state.doc.sliceString(range.from, range.to);

  return {
    changes: [{ from: range.from, to: range.to, insert: `![${text}]()` }],
    selection: { anchor: range.from + text.length + 4 },
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

/**
 * Коллаут `> [!тип] Подпись` (задача 103).
 *
 * Без выделения — со своей строки, курсор на пустой строке тела: писать
 * начинают именно там. С выделением — задетые строки целиком становятся
 * телом, и знак цитаты ставится на каждую: абзацы, разделённые пустой
 * строкой, остаются внутри коллаута (пустая строка становится `>`), как
 * в плагине владельца.
 */
export function insertCallout(state: EditorState, type: string, title: string): Edit {
  const range = state.selection.main;
  const head = title ? `> [!${type}] ${title}` : `> [!${type}]`;
  const { doc } = state;

  /**
   * Строка цитаты рядом — значит, без пустой строки коллаут слился бы с ней:
   * строки `>` подряд — это одна цитата, и в CommonMark, и в Obsidian.
   * Найдено на живом окне: вставленный сразу под другим коллаутом
   * становился его продолжением.
   */
  const quote = (number: number): boolean =>
    number >= 1 && number <= doc.lines && /^\s*>/.test(doc.line(number).text);

  if (range.empty) {
    const line = doc.lineAt(range.from);
    const alone = line.text.trim() === '';
    // На пустой строке блок встаёт на её место, иначе — строкой ниже.
    const above = alone ? line.number - 1 : line.number;
    const below = line.number + 1;

    let block = `${head}\n> `;
    if (quote(above)) block = `\n${block}`;
    const insert = alone ? block : `\n${block}`;
    const at = alone ? line.from : line.to;
    const tail = quote(below) ? '\n' : '';

    return {
      changes: [{ from: at, to: alone ? line.to : at, insert: insert + tail }],
      selection: { anchor: at + insert.length },
    };
  }

  const first = doc.lineAt(range.from);
  // Выделение, кончающееся в самом начале строки, эту строку не задевает:
  // так выглядит выделение нескольких строк целиком тройным щелчком.
  const lastPos = range.to > range.from && doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to;
  const last = doc.lineAt(Math.max(range.from, lastPos));

  const body = doc
    .sliceString(first.from, last.to)
    .split('\n')
    .map((text) => (text.trim() === '' ? '>' : `> ${text}`))
    .join('\n');
  const lead = quote(first.number - 1) ? '\n' : '';
  const insert = `${lead}${head}\n${body}`;
  const tail = quote(last.number + 1) ? '\n' : '';

  return {
    changes: [{ from: first.from, to: last.to, insert: insert + tail }],
    selection: { anchor: first.from + insert.length },
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
