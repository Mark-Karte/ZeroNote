import { styleTags, tags } from '@lezer/highlight';
import type { DelimiterType, MarkdownConfig } from '@lezer/markdown';

import { continues } from './math';

/**
 * Комментарии `%%…%%` — расширение разбора markdown (задача 130).
 *
 * Синтаксис Obsidian: текст между двумя парами процентов — заметка
 * автора для себя, в печать и экспорт он не идёт. В заметке он виден
 * приглушённым, со знаками: прятать то, что человек сам написал и может
 * захотеть поправить, превью не должно.
 *
 * Два вида, как у Obsidian:
 *
 * * **строчный** — `%%…%%` внутри абзаца, в том числе через перенос
 *   строки: пара ограничителей, как у `==выделения==`;
 * * **блоком** — строка, начатая `%%` без второй пары, открывает
 *   комментарий до первой строки, где `%%` встретится. Незакрытый
 *   тянется до конца файла — как незакрытый блок кода и frontmatter
 *   (Р-274): разбор строится по частям и вперёд не заглядывает.
 */

const DELIMITER: DelimiterType = { resolve: 'NoteComment', mark: 'NoteCommentMark' };

/** Код знака `%`. */
const PERCENT = 37;

export const noteComments: MarkdownConfig = {
  defineNodes: [{ name: 'NoteCommentBlock', block: true }, 'NoteComment', 'NoteCommentMark'],
  parseBlock: [
    {
      name: 'NoteCommentBlock',
      before: 'HTMLBlock',
      parse(cx, line) {
        if (line.next !== PERCENT || line.text.charCodeAt(line.pos + 1) !== PERCENT) return false;
        // Вторая пара на той же строке — это строчный комментарий,
        // и за ним может идти текст: его разберёт абзац.
        if (line.text.includes('%%', line.pos + 2)) return false;

        const from = cx.lineStart + line.pos;
        let to = cx.lineStart + line.text.length;
        // Глубина — чтобы комментарий в цитате не ушёл за её пределы:
        // строка без `>` цитату закрывает.
        while (cx.nextLine() && continues(cx, line)) {
          to = cx.lineStart + line.text.length;
          if (line.text.includes('%%')) {
            cx.nextLine();
            break;
          }
        }

        cx.addElement(cx.elt('NoteCommentBlock', from, to));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: 'NoteComment',
      parse(cx, next, pos) {
        if (next !== PERCENT || cx.char(pos + 1) !== PERCENT) return -1;
        return cx.addDelimiter(DELIMITER, pos, pos + 2, true, true);
      },
      before: 'Emphasis',
    },
  ],
  props: [
    styleTags({
      // `/...` — и всё внутри: курсив в комментарии остаётся комментарием.
      'NoteComment/...': tags.comment,
      NoteCommentBlock: tags.comment,
    }),
  ],
};
