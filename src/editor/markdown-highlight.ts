import { styleTags, tags } from '@lezer/highlight';
import type { DelimiterType, MarkdownConfig } from '@lezer/markdown';

/**
 * Выделение `==так==` — расширение разбора markdown.
 *
 * В CommonMark его нет, в GitHub Flavored Markdown тоже; оно пришло из
 * Obsidian, и наша панель разметки ставит именно его (задача 43). До задачи 57
 * знаки `==` доезжали до экрана обычным текстом: кнопка была, а выделения
 * не было.
 *
 * Разбор — тот же приём, что у зачёркивания в GFM: пара ограничителей,
 * которую разрешает сам движок. Двадцать строк вместо своего прохода
 * по тексту, и подсветка внутри выделения продолжает работать.
 */

const DELIMITER: DelimiterType = { resolve: 'Highlight', mark: 'HighlightMark' };

/** Код знака `=`. Сравниваем с кодом, а не с литерой: так работает разбор. */
const EQUALS = 61;

export const highlightMark: MarkdownConfig = {
  defineNodes: ['Highlight', 'HighlightMark'],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        // Одиночный `=` — это просто знак равенства, и трогать его нельзя:
        // в заметке про код он встречается на каждой строке.
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS) return -1;
        return cx.addDelimiter(DELIMITER, pos, pos + 2, true, true);
      },
      // После курсива и жирного: `==**оба**==` должно разбираться как
      // выделение с жирным внутри, а не наоборот.
      after: 'Emphasis',
    },
  ],
  props: [
    styleTags({
      // `/...` — содержимое узла, а не он сам: иначе стиль лёг бы и на знаки.
      'Highlight/...': tags.special(tags.emphasis),
      HighlightMark: tags.processingInstruction,
    }),
  ],
};
