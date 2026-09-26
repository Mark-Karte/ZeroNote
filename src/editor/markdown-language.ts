import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { Parser } from '@lezer/common';
import type { MarkdownParser } from '@lezer/markdown';

import { frontmatter } from './frontmatter';
import { mathSyntax } from './math';
import { languages } from './markdown-code';
import { highlightMark } from './markdown-highlight';

/**
 * Разбор markdown — один на редактор и на вывод HTML (задача 108).
 *
 * Редактор получает его из реестра языков (`langs.ts`), вывод для печати
 * и экспорта — отсюда же. Два разных разбора разошлись бы молча: превью
 * показало бы `==выделение==`, а напечатанное — знаки равенства. Отсюда
 * правило: всё, что меняет разбор (расширения, языки блоков кода), меняется
 * здесь и только здесь.
 */
export function markdownSupport() {
  return markdown({
    base: markdownLanguage,
    // Код внутри блоков подсвечивается своим языком: в заметках разработчика
    // блоки кода — обычное дело, и без подсветки они выглядят чужеродно.
    codeLanguages: languages,
    // Выделение `==так==`: его ставит наша панель разметки, а в GFM такого
    // узла нет (задача 57). Frontmatter — узлом, а не своим поиском
    // по тексту у каждого потребителя (задача 114). Формулы `$…$`
    // и `$$…$$` — тоже узлами (задача 115).
    extensions: [highlightMark, frontmatter, mathSyntax],
  });
}

/**
 * Разбор куска из середины заметки — для копирования выделения.
 *
 * Тот же разбор без frontmatter: он бывает только в начале файла, а кусок
 * начинается где угодно. Выделение от черты `---` вниз иначе ушло бы
 * в служебные поля целиком — незакрытый frontmatter тянется до конца.
 */
export function fragmentParser(): Parser {
  return (markdownSupport().language.parser as MarkdownParser).configure({
    remove: ['Frontmatter'],
  });
}
