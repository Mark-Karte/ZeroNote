import { RangeSetBuilder, type EditorState } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  highlightWhitespace,
  type DecorationSet,
} from '@codemirror/view';

/**
 * Невидимые символы: пробелы, табуляции и переносы строк.
 *
 * Пробелы и табы рисует CodeMirror — он же и решает, где они. Своего здесь
 * только перенос строки: его в библиотеке нет, а без него не видно, где
 * кончается строка с хвостовыми пробелами, — то есть половина смысла режима
 * пропадает.
 *
 * **Перенос помечается одним знаком, а не «CRLF» и «LF».** Показать разные
 * было бы честно только при разных данных, а у нас их нет: документ внутри
 * всегда с `\n`, настоящий тип переноса живёт в модели буфера и применяется
 * при записи (инвариант 5). В файле со смешанными переносами все строки
 * получили бы одинаковую подпись — то есть враньё. Тип переноса показывает
 * строка состояния, и там он один на файл, каким и является.
 */

class BreakWidget extends WidgetType {
  /** Все значки одинаковые, и подменять один другим незачем. */
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'zn-eol';
    span.textContent = '¶';
    // Для доступности это украшение, а не текст: диктору его читать не надо.
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  /** Знак переноса не выделяется и не копируется — он не часть документа. */
  override ignoreEvent(): boolean {
    return false;
  }
}

const breakMark = Decoration.widget({ widget: new BreakWidget(), side: 1 });

/**
 * Где стоят знаки переноса в этих диапазонах.
 *
 * Отдельной функцией и без обращения к представлению — чтобы проверялось
 * тестом. Последняя строка знака не получает: после неё переноса нет,
 * и пометить его значило бы придумать в файле то, чего в нём нет.
 */
export function breakPositions(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): number[] {
  const out: number[] = [];
  const last = state.doc.lines;

  for (const range of ranges) {
    let number = state.doc.lineAt(range.from).number;
    const stop = state.doc.lineAt(range.to).number;

    for (; number <= stop; number += 1) {
      if (number >= last) break;
      out.push(state.doc.line(number).to);
    }
  }

  return out;
}

/**
 * Обходятся только видимые строки: файл бывает в миллион строк, а на экране
 * их всегда полсотни. Инвариант 6 не делает исключения для оформления.
 */
const lineBreaks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: { view: EditorView; docChanged: boolean; viewportChanged: boolean }): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      for (const at of breakPositions(view.state, view.visibleRanges)) {
        builder.add(at, at, breakMark);
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Всё вместе: пробелы и табы от CodeMirror, переносы свои. */
export function invisibles(): ReturnType<typeof highlightWhitespace>[] {
  return [highlightWhitespace(), lineBreaks];
}
