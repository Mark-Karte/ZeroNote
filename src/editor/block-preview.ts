import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

import { diagramBlock } from './diagram';
import { touched } from './live-preview';
import { MathWidget, drawsAsBlock, mathSource } from './math';
import { tableBlock } from './tables';

/**
 * Блочное превью: всё, что заменяется целыми строками, — таблицы
 * (задача 73), блочные формулы (задача 115) и схемы mermaid (задача 117).
 *
 * Отдельно от прочего превью, и не по прихоти: замена через границу строк
 * меняет высоту документа, а такие украшения CodeMirror принимает только
 * от поля состояния — плагин их не отдаёт (Р-203). Цена — обход всего
 * дерева вместо видимых строк. Поле одно на оба вида блоков ради того же:
 * второе поле обходило бы дерево второй раз на каждую правку.
 */

/**
 * Узлы, внутри которых таблиц и блочных формул не бывает.
 *
 * Спускаться в них незачем, и это не преждевременная бережливость: поле
 * состояния обходит **всё** дерево на каждую правку и на каждое движение
 * курсора по строкам — в отличие от плагина, который знает про видимые
 * строки. Отсечь абзацы и заголовки значит оставить обход по верхним
 * блокам, а их в документе на порядок меньше.
 */
function isLeaf(name: string): boolean {
  return (
    name === 'Paragraph' ||
    name === 'FencedCode' ||
    name === 'CodeBlock' ||
    name === 'HorizontalRule' ||
    name === 'LinkReference' ||
    name === 'HTMLBlock' ||
    name === 'CommentBlock' ||
    name === 'Frontmatter' ||
    name.startsWith('ATXHeading') ||
    name.startsWith('SetextHeading')
  );
}

/**
 * Блочная формула: MathML на месте её строк, или `null`, если формула
 * показывается исходником. Единица раскрытия — блок, как у таблицы
 * (Р-184): курсор на любой её строке возвращает исходник целиком.
 *
 * Однострочная в пункте списка или в коллауте сюда не попадает — её
 * рисует плагин превью в строке (`drawsAsBlock`). Многострочная
 * в коллауте рисуется здесь и карточки на своих строках не получает:
 * цена замены строк, та же, что у таблицы в коллауте.
 */
function mathBlock(state: EditorState, node: SyntaxNode): Range<Decoration> | null {
  const { doc } = state;
  if (!drawsAsBlock(doc, node.from, node.to)) return null;

  const first = doc.lineAt(node.from);
  const last = doc.lineAt(Math.min(Math.max(node.from, node.to - 1), doc.length));
  for (let number = first.number; number <= last.number; number += 1) {
    if (touched(state, doc.line(number))) return null;
  }

  const read = (from: number, to: number): string => doc.sliceString(from, to);
  return Decoration.replace({
    widget: new MathWidget(read(node.from, node.to), mathSource(read, node), true),
    block: true,
  }).range(first.from, last.to);
}

/** Украшения блочного превью по всему документу. */
export function blockDecorations(state: EditorState): DecorationSet {
  const found: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'Table' || node.name === 'BlockMath') {
        const block = node.name === 'Table' ? tableBlock(state, node.node) : mathBlock(state, node.node);
        if (block) found.push(block);
        return false;
      }
      // Блок кода бывает схемой: ` ```mermaid ` рисуется, прочие — нет.
      if (node.name === 'FencedCode') {
        const block = diagramBlock(state, node.node, (line) => touched(state, state.doc.line(line)));
        if (block) found.push(block);
        return false;
      }
      if (isLeaf(node.name)) return false;
      return undefined;
    },
  });

  return Decoration.set(found, true);
}

/**
 * Что помнит поле: сами украшения и то, от чего они зависели.
 *
 * Второе — не кэш ради кэша, а мера, найденная приёмкой этапа 10:
 * см. `signature`.
 */
interface BlockState {
  decorations: DecorationSet;
  /** Строки, которых касается выделение. */
  signature: string;
}

/**
 * Отпечаток выделения по строкам.
 *
 * Раскрытие блока зависит не от места курсора, а от **строк**, которых
 * он касается (Р-184). Значит, движение внутри строки ничего не меняет —
 * и пересчитывать по нему нечего.
 *
 * Приёмка этапа 10 показала, во что обходится обратное: обход всего дерева
 * на каждое движение курсора стоил 0,4 мс против 0,03 мс без таблиц —
 * в десять с лишним раз больше. До кадра всё равно далеко, но платить
 * за ничего незачем.
 */
function signature(state: EditorState): string {
  const { doc } = state;
  return state.selection.ranges
    .map((range) => `${doc.lineAt(range.from).number}:${doc.lineAt(range.to).number}`)
    .join(',');
}

/**
 * Поле блочного превью — см. `blockDecorations`.
 *
 * Пересчёт идёт на правку, на приезд разбора и на смену **строк** выделения.
 * Второе обязательно и найдено ещё в задаче 64 (Р-169): язык подключается
 * своим отсеком и позже, чем превью, и без сравнения деревьев таблица
 * оставалась бы исходником до первого нажатия.
 */
export function blockPreview(): Extension {
  return StateField.define<BlockState>({
    create: (state) => ({
      decorations: blockDecorations(state),
      signature: signature(state),
    }),

    update(value, tr) {
      if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return {
          decorations: blockDecorations(tr.state),
          signature: signature(tr.state),
        };
      }

      if (tr.selection !== undefined) {
        const next = signature(tr.state);
        if (next !== value.signature) {
          return { decorations: blockDecorations(tr.state), signature: next };
        }
      }

      return value;
    },

    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
}
