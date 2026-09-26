import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags, type Tag } from '@lezer/highlight';
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

/** Доля сжатия заголовка по уровню (задача 122): ряд Obsidian. */
const HEADING_SQUEEZE = [1.5, 1.1, 0.8, 0.5, 0.2, 0];

/** Теги заголовков по уровню: первый — `heading1`. */
const HEADING_TAGS = [
  tags.heading1,
  tags.heading2,
  tags.heading3,
  tags.heading4,
  tags.heading5,
  tags.heading6,
];

/**
 * Роли кода: какие теги разбора каким токеном красятся.
 *
 * Список один на редактор и на вывод HTML (задача 108): в редакторе роль
 * становится цветом, в выводе — классом `zn-syn-роль`, который красит
 * стиль документа тем же токеном. Два списка разошлись бы молча, и код
 * на бумаге был бы раскрашен иначе, чем на экране.
 */
export const CODE_ROLES: ReadonlyArray<{ tag: Tag | Tag[]; role: string }> = [
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], role: 'keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.character], role: 'string' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], role: 'comment' },
  { tag: [tags.number, tags.bool, tags.atom, tags.literal], role: 'number' },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.typeName)],
    role: 'type',
  },
  { tag: [tags.function(tags.variableName), tags.macroName], role: 'function' },
  { tag: [tags.operator, tags.derefOperator, tags.compareOperator], role: 'operator' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], role: 'variable' },
  { tag: [tags.punctuation, tags.bracket, tags.separator], role: 'punctuation' },
  { tag: tags.invalid, role: 'invalid' },
];

export const zeronoteHighlight = HighlightStyle.define([
  ...CODE_ROLES.map(({ tag, role }) => ({ tag, color: c(role) })),

  // Markdown и разметка. Здесь работает не цвет, а начертание: заголовок
  // отличается весом, курсив — наклоном. У заголовка это единственное
  // отличие — во встроенных темах его цвет совпадает с цветом обычного
  // текста (Р-082), и без веса он ничем бы не выделялся.
  //
  // Задача 57 добавила к весу размер, но **только** оформление: знаки
  // разметки остаются на экране (Р-152). Файл на экране — тот же, что
  // на диске, и это исходный режим, а не живое превью.
  {
    tag: tags.heading,
    color: c('heading'),
    fontWeight: 'var(--zn-font-weight-heading)',
  },
  // Во встроенных темах растут в размере первые три уровня, дальше
  // хватает веса: в заметке редко бывает вложенность глубже трёх,
  // а шестой уровень, набранный крупнее обычного текста, выглядел бы
  // обещанием, которого нет. Тема вправе задать все шесть — так делает
  // «Obsidian» (задача 122); у прочих четвёртый–шестой — 1em.
  //
  // Сжатие — единица-токен, умноженная на долю уровня: ряд Obsidian
  // (Р-283). У встроенных тем единица — ноль, и сжатия нет.
  ...[1, 2, 3, 4, 5, 6].map((level) => ({
    tag: HEADING_TAGS[level - 1]!,
    color: c('heading'),
    fontWeight: 'var(--zn-font-weight-heading)',
    fontSize: `var(--zn-font-size-editor-heading-${level})`,
    letterSpacing: `calc(var(--zn-font-letter-spacing-heading) * ${HEADING_SQUEEZE[level - 1]})`,
  })),
  { tag: [tags.link, tags.url], color: c('link') },
  { tag: tags.emphasis, color: c('emphasis'), fontStyle: 'italic' },
  {
    tag: tags.strong,
    color: c('strong'),
    fontWeight: 'var(--zn-font-weight-strong)',
  },
  { tag: [tags.quote, tags.meta], color: c('quote') },
  // Зачёркнутое в markdown: цвет не меняем, меняем начертание.
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  // Строчный код — подложкой, как блок кода, но без рамки: короткий кусок
  // в строке прозы. Отступов нет намеренно: они сдвинули бы соседние знаки,
  // а в исходном режиме столбцы должны оставаться на месте.
  {
    tag: tags.monospace,
    backgroundColor: 'var(--zn-color-bg-canvas)',
    borderRadius: 'var(--zn-radius-sm)',
  },
  // Выделение `==так==` — не CommonMark, разбор свой (`markdown-highlight.ts`),
  // и подложка у него ярче, чем у строчного кода: это пометка, а не код.
  {
    tag: tags.special(tags.emphasis),
    backgroundColor: 'var(--zn-color-bg-selected)',
    borderRadius: 'var(--zn-radius-sm)',
  },
  // Знаки разметки: решётки заголовка, звёздочки жирного, угловая скобка
  // цитаты, маркер списка, обратные кавычки. Тише текста, но на месте.
  { tag: tags.processingInstruction, color: c('markup') },
  // Горизонтальная черта: сами дефисы. Рисовать вместо них линию — уже
  // не оформление, а подмена (Р-152).
  { tag: tags.contentSeparator, color: c('markup') },
]);

/**
 * Постоянные классы для разметки, которую оформление находит по классу,
 * а не по цвету (задача 122).
 *
 * Своим стилем, а не строкой в `zeronoteHighlight`: у `HighlightStyle`
 * запись с `class` берёт только класс, и цвет с подложкой строчного кода
 * пропали бы. Два стиля подсветки CodeMirror складывает.
 *
 * `zn-mono` — строчный код и текст блока кода без языка: в заметке
 * с пропорциональным шрифтом им нужен моноширинный (`editor.css`).
 */
export const markupClasses = HighlightStyle.define([{ tag: tags.monospace, class: 'zn-mono' }]);

export const syntaxColors: Extension = [
  syntaxHighlighting(zeronoteHighlight),
  syntaxHighlighting(markupClasses),
];
