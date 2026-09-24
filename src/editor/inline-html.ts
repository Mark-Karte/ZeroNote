/**
 * Строчный HTML в markdown: что показывать оформлением (задача 107).
 *
 * CommonMark разрешает сырой HTML, заметки Obsidian им пользуются, а `<u>`
 * вставляет наша собственная кнопка подчёркивания (задача 102). До задачи
 * 107 превью показывало такие теги как есть, со скобками: кнопка ставила
 * разметку, которую сами мы не рисовали.
 *
 * Показывается **белый список парных строчных тегов, и только без
 * атрибутов**. Атрибут — это уже стиль, класс или обработчик события;
 * превью их не исполняет и смысла им не сочиняет (Р-178), а тег с атрибутом
 * остаётся исходником. Всё, чего нет в списке, — тоже.
 *
 * Список один на превью и на вывод HTML (задача 108): два правила о том,
 * какой HTML «наш», разошлись бы молча. `<br>` в список превью не входит —
 * он не парный, а разорвать строку внутри строки CodeMirror не даёт; его
 * возьмёт только вывод.
 *
 * Чистые функции без DOM и без дерева разбора: на входе текст тегов и их
 * места, на выходе пары. Проверяются тестом.
 */

/** Парные теги, которые превью рисует оформлением. */
export const INLINE_TAGS = ['u', 'sub', 'sup', 'kbd', 'mark'] as const;

export type InlineTag = (typeof INLINE_TAGS)[number];

/** Распознанный тег: какой и закрывающий ли. */
export interface TagMark {
  name: InlineTag;
  closing: boolean;
}

/**
 * `<u>`, `</u>`, `<U >` — да; `<u class="x">`, `<u/>`, `< u>` — нет.
 *
 * Пробел перед `>` HTML допускает, после `<` — нет: `< u>` это текст.
 */
const TAG = /^<(\/?)([a-z]+)\s*>$/i;

function isInlineTag(name: string): name is InlineTag {
  return (INLINE_TAGS as readonly string[]).includes(name);
}

/** Узнать тег из белого списка. Всё прочее — `null`, то есть исходник. */
export function readTag(text: string): TagMark | null {
  const match = TAG.exec(text);
  if (!match) return null;

  const name = match[2]!.toLowerCase();
  if (!isInlineTag(name)) return null;

  return { name, closing: match[1] === '/' };
}

/** Тег на своём месте в документе. */
export interface PlacedTag {
  from: number;
  to: number;
  tag: TagMark;
}

/** Открывающий и закрывающий тег одной пары. */
export interface TagPair {
  name: InlineTag;
  open: { from: number; to: number };
  close: { from: number; to: number };
}

/**
 * Разобрать теги на пары — так, как это делает браузер в простых случаях.
 *
 * Теги идут по порядку. Закрывающий ищет ближайший открытый с тем же именем;
 * всё, что открыто позже него и не закрыто, остаётся без пары — исходником.
 * Закрывающий без открытого — тоже исходник. Показывать оформление там,
 * где пары нет, значило бы угадывать, где оно кончается.
 */
export function pairTags(tags: readonly PlacedTag[]): TagPair[] {
  const open: PlacedTag[] = [];
  const pairs: TagPair[] = [];

  for (const placed of tags) {
    if (!placed.tag.closing) {
      open.push(placed);
      continue;
    }

    let index = open.length - 1;
    while (index >= 0 && open[index]!.tag.name !== placed.tag.name) index -= 1;
    if (index < 0) continue;

    const start = open[index]!;
    open.length = index;
    pairs.push({
      name: placed.tag.name,
      open: { from: start.from, to: start.to },
      close: { from: placed.from, to: placed.to },
    });
  }

  return pairs;
}
