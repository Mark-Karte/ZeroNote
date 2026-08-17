import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * Цвета подсветки синтаксиса — токены темы (решение Р-047).
 *
 * Значения берутся не из темы напрямую, а через CSS-переменные. Это важно:
 * стиль подсветки собирается один раз при запуске, а смена темы меняет
 * переменные на `:root` — и цвета кода едут за ней без пересборки стиля
 * и без переоткрытия вкладок.
 *
 * Роли общие для всех языков: «ключевое слово», а не «ключевое слово Rust».
 * Иначе автор темы обязан был бы знать пятнадцать языков, а не пятнадцать
 * ролей.
 */

const c = (name: string): string => `var(--zn-color-syntax-${name})`;

export const zeronoteHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: c('keyword') },
  { tag: [tags.string, tags.special(tags.string), tags.character], color: c('string') },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: c('comment') },
  { tag: [tags.number, tags.bool, tags.atom, tags.literal], color: c('number') },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.typeName)],
    color: c('type'),
  },
  { tag: [tags.function(tags.variableName), tags.macroName], color: c('function') },
  { tag: [tags.operator, tags.derefOperator, tags.compareOperator], color: c('operator') },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: c('variable') },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: c('punctuation') },
  { tag: tags.invalid, color: c('invalid') },

  // Markdown и разметка. Здесь важен не только цвет: заголовок без веса
  // и курсив без наклона не читаются как заголовок и курсив.
  {
    tag: tags.heading,
    color: c('heading'),
    fontWeight: 'var(--zn-font-weight-medium)',
  },
  { tag: [tags.link, tags.url], color: c('link') },
  { tag: tags.emphasis, color: c('emphasis'), fontStyle: 'italic' },
  {
    tag: tags.strong,
    color: c('strong'),
    fontWeight: 'var(--zn-font-weight-medium)',
  },
  { tag: [tags.quote, tags.meta], color: c('quote') },
  // Зачёркнутое в markdown: цвет не меняем, меняем начертание.
  { tag: tags.strikethrough, textDecoration: 'line-through' },
]);

export const syntaxColors: Extension = syntaxHighlighting(zeronoteHighlight);
