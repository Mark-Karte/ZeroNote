import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';

/**
 * Цитаты в markdown: черта слева и отступ.
 *
 * Цвет текста цитаты задаётся подсветкой (`tags.quote`), но цветом одним
 * блок не читается: строка тише соседних — это ещё не «здесь цитата».
 * Черту нельзя выразить подсветкой вовсе — подсветка красит куски текста,
 * а черта принадлежит строке целиком. Отсюда украшение строки.
 *
 * Угловая скобка `>` остаётся на экране, как и все знаки разметки (Р-152):
 * черта добавляется к ней, а не заменяет её.
 *
 * Обходятся только видимые строки: цитата бывает длиной в файл, а на экране
 * всегда полсотни строк (инвариант 6). Тот же приём, что у блоков кода.
 */

const quoteLine = Decoration.line({ class: 'zn-quote' });

/**
 * Разметить цитаты в заданных отрезках документа.
 *
 * Принимает состояние и отрезки, а не представление, — чтобы проверяться
 * тестом без окна.
 */
export function decorateQuotes(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = state;
  const tree = syntaxTree(state);

  // Номера строк, а не смещения: вложенная цитата (`>>`) даёт два узла
  // на одну строку, и без отсева одна строка получила бы два украшения —
  // а `RangeSetBuilder` требует строго возрастающих позиций и падает
  // на повторе.
  const marked = new Set<number>();

  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'Blockquote') return;

        const first = doc.lineAt(Math.max(node.from, range.from));
        // Шаг назад: у цитаты, дописанной до конца документа, `node.to`
        // указывает уже на начало следующей строки. Та же поправка,
        // что у блоков кода.
        const last = doc.lineAt(Math.min(Math.max(node.from, node.to - 1), range.to));

        for (let number = first.number; number <= last.number; number += 1) {
          if (marked.has(number)) continue;
          marked.add(number);
          builder.add(doc.line(number).from, doc.line(number).from, quoteLine);
        }
      },
    });
  }

  return builder.finish();
}

/** Оформление цитат. Ставится рядом с разбором markdown. */
export function quotes() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = decorateQuotes(view.state, view.visibleRanges);
      }

      update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = decorateQuotes(update.view.state, update.view.visibleRanges);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
