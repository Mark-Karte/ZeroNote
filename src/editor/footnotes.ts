import { styleTags, tags } from '@lezer/highlight';
import type { BlockContext, LeafBlock, LeafBlockParser, Line, MarkdownConfig } from '@lezer/markdown';

/**
 * Сноски `[^1]` — расширение разбора markdown (задача 130).
 *
 * В CommonMark их нет, и до задачи 130 разбор читал `[^1]` ссылкой, а
 * определение из одного слова — `[^1]: Слово` — определением ссылки:
 * вывод HTML такое определение молча выбрасывает, как всякое определение
 * ссылки. Теперь это свои узлы:
 *
 * * `FootnoteRef` — ссылка на сноску в тексте: `[^метка]`;
 * * `FootnoteDef` — метка определения в начале строки: `[^метка]:`.
 *   Текст сноски — обычный текст абзаца за ней.
 *
 * Метка — без пробелов и скобок, как у Obsidian и Pandoc. Нумерации,
 * переходов и списка сносок в конце нет: превью показывает метку
 * надстрочным знаком, вывод — `<sup>`, и ничего не сочиняет (Р-178).
 */

const BRACKET_OPEN = 91; // [
const BRACKET_CLOSE = 93; // ]
const CARET = 94; // ^
const COLON = 58; // :
const NEWLINE = 10;

/** Определение сноски в начале абзаца. */
const DEFINITION = /^\[\^[^\s\]\[]+\]:/;

/**
 * Абзац, который начинается определением сноски, — обычный абзац.
 *
 * Иначе его забрал бы разбор определений ссылок: `[^1]: Слово` для
 * CommonMark — определение ссылки с меткой `^1` и адресом `Слово`.
 * Этот разбор стоит раньше и отдаёт абзац так же, как его собрал бы сам
 * движок, — с метками цитаты внутри (`addLeafElement`).
 */
class DefinitionParagraph implements LeafBlockParser {
  /**
   * Следующее определение подряд — новый абзац. Иначе его перехватил бы
   * разбор определений ссылок: он заканчивает лист, как только видит
   * на следующей строке новое определение, и первое уходило ему (найдено
   * тестом). Эта строка не съедается: с неё начнётся следующий абзац.
   */
  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    if (!DEFINITION.test(line.text.slice(line.pos))) return false;
    return this.finish(cx, leaf);
  }

  finish(cx: BlockContext, leaf: LeafBlock): boolean {
    cx.addLeafElement(
      leaf,
      cx.elt(
        'Paragraph',
        leaf.start,
        leaf.start + leaf.content.length,
        cx.parser.parseInline(leaf.content, leaf.start),
      ),
    );
    return true;
  }
}

export const footnotes: MarkdownConfig = {
  defineNodes: ['FootnoteRef', 'FootnoteDef', 'FootnoteMark', 'FootnoteLabel'],
  parseBlock: [
    {
      name: 'FootnoteDefinition',
      before: 'LinkReference',
      leaf: (_cx, leaf) => (DEFINITION.test(leaf.content) ? new DefinitionParagraph() : null),
    },
  ],
  parseInline: [
    {
      name: 'Footnote',
      // Раньше ссылки: иначе `[^1]` забрала бы она.
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== BRACKET_OPEN || cx.char(pos + 1) !== CARET) return -1;

        let end = pos + 2;
        while (end < cx.end) {
          const char = cx.char(end);
          if (char === BRACKET_CLOSE) break;
          // Пробел, перенос, скобка — не метка: `[^ так]` остаётся текстом.
          if (char === 32 || char === 9 || char === 10 || char === BRACKET_OPEN) return -1;
          end += 1;
        }
        if (end >= cx.end || end === pos + 2) return -1;

        const close = end + 1;
        const label = [cx.elt('FootnoteMark', pos, pos + 2), cx.elt('FootnoteLabel', pos + 2, end)];

        // Метка с двоеточием в начале строки — определение. Строки, а не
        // абзаца: определения подряд, без пустых строк между ними, —
        // обычное дело, и каждое из них — определение (найдено на живом
        // окне: второе выходило ссылкой на сноску).
        const lineStart = pos === cx.offset || cx.char(pos - 1) === NEWLINE;
        if (lineStart && cx.char(close) === COLON) {
          return cx.addElement(
            cx.elt('FootnoteDef', pos, close + 1, [...label, cx.elt('FootnoteMark', end, close + 1)]),
          );
        }
        return cx.addElement(cx.elt('FootnoteRef', pos, close, [...label, cx.elt('FootnoteMark', end, close)]));
      },
    },
  ],
  props: [
    styleTags({
      'FootnoteRef FootnoteDef': tags.link,
      FootnoteMark: tags.processingInstruction,
    }),
  ],
};
