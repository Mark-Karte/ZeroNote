import type { EditorState } from '@codemirror/state';
import { plural } from './plural';

/**
 * Позиция курсора для строки состояния.
 *
 * Отдельным модулем, а не выражением внутри компонента, по двум причинам:
 * это чистая функция над состоянием редактора, и её можно проверить тестом
 * без окна; и она лежит на пути ввода, а значит её цену надо уметь мерить
 * отдельно от всего остального.
 *
 * **Столбец считается в единицах UTF-16, а не в символах.** Разница видна
 * только на строках с астральными знаками — эмодзи и подобным, — потому что
 * буква любого алфавита занимает одну единицу. Выбор сделан ради инварианта 6:
 * позиция в строке берётся вычитанием, то есть за постоянное время, тогда как
 * подсчёт настоящих символов означал бы просмотр начала строки на каждое
 * нажатие. В файле с одной строкой на десять мегабайт — а такие открывают
 * именно в редакторе этого класса — это была бы заметная задержка ввода.
 *
 * Табуляция считается за один столбец, как в Notepad++ по умолчанию: столбец
 * здесь — позиция в строке, а не координата на экране.
 */
export interface Position {
  /** Номер строки, считая с единицы. */
  line: number;
  /** Позиция в строке, считая с единицы. */
  column: number;
  /** Сколько выделено — суммарно по всем диапазонам. Ноль — выделения нет. */
  selected: number;
  /**
   * Сколько строк захватывает выделение.
   *
   * `null`, когда считать нечего или незачем: выделения нет либо диапазонов
   * несколько. Во втором случае число строк было бы вымыслом — диапазоны
   * могут лежать и на одной строке, и вразброс, а сколько их, и так видно
   * по счётчику курсоров.
   */
  selectedLines: number | null;
}

export function positionOf(state: EditorState): Position {
  const { main, ranges } = state.selection;
  const line = state.doc.lineAt(main.head);

  let selected = 0;
  for (const range of ranges) {
    selected += range.to - range.from;
  }

  let selectedLines: number | null = null;
  if (selected > 0 && ranges.length === 1) {
    selectedLines =
      state.doc.lineAt(main.to).number - state.doc.lineAt(main.from).number + 1;
  }

  return {
    line: line.number,
    column: main.head - line.from + 1,
    selected,
    selectedLines,
  };
}

/** Короткая подпись для строки состояния. */
export function positionLabel(position: Position): string {
  const base = `стр ${position.line}, кол ${position.column}`;
  if (position.selected === 0) {
    return base;
  }

  const lines = position.selectedLines;
  // Про одну строку не пишем: это и так видно, а строка состояния узкая.
  const tail =
    lines !== null && lines > 1
      ? ` в ${lines} ${plural(lines, 'строке', 'строках', 'строках')}`
      : '';

  return `${base} · выделено ${position.selected}${tail}`;
}
