import type { EditorState, Range } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

import { icon, type IconName } from '../icons/registry';
import { closesFrontmatter } from './frontmatter';
import { touched } from './live-preview';

/**
 * Свойства — frontmatter карточкой, как у Obsidian (задача 127).
 *
 * **Только показ** (ответ владельца на вопрос 3 плана этапа 18): правка
 * в карточке значила бы переписывать YAML человека нашим кодом — ровно
 * то, от чего бережёт инвариант 1. Курсор в любой строке frontmatter
 * возвращает его исходником целиком (Р-184), и правится он там как текст.
 *
 * Разбор — свой и узкий, без библиотеки YAML: `ключ: значение`, список
 * строками `- …` под ключом и `[a, b]` в строку, строки в кавычках,
 * комментарии. **Всё, чего разбор не понял, — исходником, целиком**:
 * вложенные словари, многострочные значения, якоря, `|` и `>`. Карточка,
 * показавшая половину свойств, врала бы о файле; исходник не врёт.
 *
 * Своих слов на экране нет (Р-178): ни заголовка «Свойства», ни кнопки
 * «Добавить свойство» — ключи и значения те, что в файле, тип сказан
 * значком. Дата — как записана, а не по-местному: переставить её значит
 * написать то, чего в файле нет.
 */

/** Тип значения — по нему значок и вид. */
export type PropertyKind =
  | 'text'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'datetime'
  | 'list'
  | 'tags'
  | 'aliases';

export interface Property {
  key: string;
  kind: PropertyKind;
  /** Значения: у списка — пункты, у прочих — одно или ни одного. */
  values: string[];
  /** Номер строки ключа от начала frontmatter: 1 — первая за `---`. */
  line: number;
}

/** Ключ и то, что за ним. Ключ — без кавычек и служебных знаков YAML в начале. */
const KEY = /^([^\s#:'"\-?[\]{},&*!|>%@`][^:]*?)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;

/** Пункт списка строкой: `- значение` или пустой `-`. */
const ITEM = /^[ \t]*-(?:[ \t]+(.*?))?[ \t]*$/;

/** Строка без смысла для свойств: пустая или комментарий. */
const QUIET = /^[ \t]*(?:#.*)?$/;

/**
 * Одно значение без обёрток: кавычки сняты, комментарий в конце отрезан.
 * `null` — значение, которого узкий разбор не понимает.
 */
export function readScalar(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return '';

  if (text.startsWith('"')) {
    // Обратная косая в двойных кавычках — управляющая последовательность
    // YAML; толковать их все незачем, и показывать её сырой нельзя.
    const close = text.indexOf('"', 1);
    if (close < 0 || text.slice(1, close).includes('\\')) return null;
    if (!QUIET.test(text.slice(close + 1))) return null;
    return text.slice(1, close);
  }

  if (text.startsWith("'")) {
    // В одинарных кавычках одна замена: `''` — это `'`.
    const match = /^'((?:[^']|'')*)'(.*)$/.exec(text);
    if (!match || !QUIET.test(match[2] ?? '')) return null;
    return (match[1] ?? '').replace(/''/g, "'");
  }

  // Якорь, ссылка на якорь, тег типа, многострочное значение, словарь
  // и вложенный список — не наш разбор.
  if (/^[&*!|>{[]/.test(text)) return null;

  // Комментарий — с пробелом перед решёткой: `C#` и `#тег` в значении
  // остаются значением.
  const comment = text.search(/[ \t]#/);
  const value = comment < 0 ? text : text.slice(0, comment).trimEnd();
  return value === '~' || value === 'null' ? '' : value;
}

/** Список в строку `[a, b]`; `null` — не понят. */
export function readFlowList(raw: string): string[] | null {
  const text = raw.trim();
  const match = /^\[(.*)\](.*)$/.exec(text);
  if (!match || !QUIET.test(match[2] ?? '')) return null;

  const inside = match[1] ?? '';
  if (inside.trim() === '') return [];

  const items: string[] = [];
  let current = '';
  let quote = '';
  for (const char of inside) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ',') {
      items.push(current);
      current = '';
    } else if (char === '[' || char === ']' || char === '{' || char === '}') {
      return null;
    } else {
      current += char;
    }
  }
  if (quote) return null;
  items.push(current);

  const values: string[] = [];
  for (const item of items) {
    const value = readScalar(item);
    if (value === null) return null;
    // Запятая в конце — `[a, b,]` — даёт пустой пункт, которого нет.
    if (value !== '') values.push(value);
  }
  return values;
}

/** Тип значения по ключу и виду: так же догадывается Obsidian без своего списка типов. */
function kindOf(key: string, values: string[], list: boolean): PropertyKind {
  const name = key.toLowerCase();
  if (name === 'tags' || name === 'tag') return 'tags';
  if (name === 'aliases' || name === 'alias') return 'aliases';
  if (list) return 'list';

  const value = values[0] ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/.test(value)) return 'datetime';
  if (/^(?:true|false)$/i.test(value)) return 'checkbox';
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)) return 'number';
  return 'text';
}

/**
 * Теги строкой: `tags: a, b` и `tags: a b` — тоже список, так их читает
 * и Obsidian. Решётка перед тегом — знак, а не имя: прячется, как у тега
 * в тексте.
 */
function tagList(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(/[\s,]+/))
    .map((tag) => tag.replace(/^#/, ''))
    .filter((tag) => tag !== '');
}

/**
 * Свойства из строк между оградами frontmatter. `null` — разбор чего-то
 * не понял, и frontmatter остаётся исходником.
 */
export function readProperties(lines: readonly string[]): Property[] | null {
  const found: Property[] = [];
  let index = 0;

  while (index < lines.length) {
    const text = lines[index] ?? '';
    if (QUIET.test(text)) {
      index += 1;
      continue;
    }

    const match = KEY.exec(text);
    if (!match) return null;
    const key = match[1] ?? '';
    const rest = match[2] ?? '';
    const line = index + 1;
    index += 1;

    if (rest.startsWith('[')) {
      const values = readFlowList(rest);
      if (values === null) return null;
      found.push({ key, kind: kindOf(key, values, true), values, line });
      continue;
    }

    if (rest !== '') {
      const value = readScalar(rest);
      if (value === null) return null;
      const values = value === '' ? [] : [value];
      found.push({ key, kind: kindOf(key, values, false), values, line });
      continue;
    }

    // Пустое значение за ключом — либо пусто, либо список строками ниже.
    // Строка ниже с отступом, но не пункт списка, — вложенный словарь
    // или продолжение значения: не наш разбор.
    const values: string[] = [];
    let list = false;
    while (index < lines.length) {
      const next = lines[index] ?? '';
      const item = ITEM.exec(next);
      if (item) {
        const value = readScalar(item[1] ?? '');
        if (value === null) return null;
        if (value !== '') values.push(value);
        list = true;
        index += 1;
      } else if (/^[ \t]*$/.test(next) || /^[ \t]*#/.test(next)) {
        index += 1;
      } else if (/^[ \t]/.test(next)) {
        return null;
      } else {
        break;
      }
    }
    found.push({ key, kind: kindOf(key, values, list), values, line });
  }

  return found.map((property) =>
    property.kind === 'tags' ? { ...property, values: tagList(property.values) } : property,
  );
}

/** Значок типа: свой у каждого, как у Obsidian. */
const KIND_ICON: Record<PropertyKind, IconName> = {
  text: 'prop.text',
  number: 'prop.number',
  checkbox: 'prop.checkbox',
  date: 'prop.date',
  datetime: 'prop.datetime',
  list: 'prop.list',
  tags: 'prop.tags',
  aliases: 'prop.aliases',
};

/** Карточка свойств на месте строк frontmatter. */
export class PropertiesWidget extends WidgetType {
  constructor(
    readonly properties: readonly Property[],
    /** Исходник целиком: по нему виджет понимает, менялось ли что-то. */
    readonly source: string,
    /** Концы строк между оградами: щелчок по свойству ставит курсор туда. */
    readonly ends: readonly number[],
  ) {
    super();
  }

  /**
   * Сравнивается исходник целиком. Место сравнивать незачем: frontmatter
   * всегда в начале файла, и при том же исходнике его строки там же.
   */
  override eq(other: PropertiesWidget): boolean {
    return other.source === this.source;
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div');
    box.className = 'zn-properties';

    for (const property of this.properties) {
      const row = document.createElement('div');
      row.className = 'zn-property';

      const key = document.createElement('span');
      key.className = 'zn-property-key';
      const mark = document.createElement('span');
      mark.className = 'zn-property-icon';
      mark.innerHTML = icon(KIND_ICON[property.kind]);
      const name = document.createElement('span');
      name.className = 'zn-property-name';
      name.textContent = property.key;
      key.append(mark, name);

      const value = document.createElement('span');
      value.className = 'zn-property-value';
      this.fill(value, property);

      row.append(key, value);

      // Щелчок по свойству — курсор в конец строки его ключа: frontmatter
      // раскрывается исходником (Р-184), и курсор стоит у значения.
      const at = this.ends[property.line - 1] ?? 0;
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        view.dispatch({ selection: { anchor: at } });
        view.focus();
      });

      box.append(row);
    }

    return box;
  }

  /** Значение по типу: плашки у списков, флажок у да-нет, текст у прочих. */
  private fill(value: HTMLElement, property: Property): void {
    if (property.kind === 'tags' || property.kind === 'list' || property.kind === 'aliases') {
      for (const item of property.values) {
        const pill = document.createElement('span');
        pill.className = property.kind === 'tags' ? 'zn-property-pill zn-property-tag' : 'zn-property-pill';
        pill.textContent = item;
        value.append(pill);
      }
      return;
    }

    if (property.kind === 'checkbox') {
      const done = (property.values[0] ?? '').toLowerCase() === 'true';
      const box = document.createElement('span');
      box.className = done ? 'zn-property-check zn-property-check-done' : 'zn-property-check';
      box.innerHTML = done ? icon('action.check') : '';
      value.append(box);
      return;
    }

    // Текст — своим куском: кегль значения меньше кегля строки, а высота
    // строки и поля меряются кеглем строки, как у Obsidian.
    const text = document.createElement('span');
    text.className = 'zn-property-text';
    text.textContent = property.values[0] ?? '';
    value.append(text);
  }

  /** Нажатия обрабатываем сами — см. `toDOM`. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Украшение frontmatter: карточка на месте его строк, или `null`, если он
 * показывается исходником — под курсором, незакрытый, пустой или
 * непонятный разбору.
 */
export function propertiesBlock(state: EditorState, node: SyntaxNode): Range<Decoration> | null {
  const { doc } = state;
  const first = doc.lineAt(node.from);
  const last = doc.lineAt(Math.min(Math.max(node.from, node.to - 1), doc.length));

  // Незакрытый — это frontmatter, который сейчас пишут: карточка из
  // половины строк прыгала бы на каждом нажатии.
  if (last.number === first.number || !closesFrontmatter(last.text)) return null;

  // Единица раскрытия — блок (Р-184).
  for (let number = first.number; number <= last.number; number += 1) {
    if (touched(state, doc.line(number))) return null;
  }

  const lines: string[] = [];
  const ends: number[] = [];
  for (let number = first.number + 1; number < last.number; number += 1) {
    const line = doc.line(number);
    lines.push(line.text);
    ends.push(line.to);
  }

  const properties = readProperties(lines);
  if (!properties || properties.length === 0) return null;

  return Decoration.replace({
    widget: new PropertiesWidget(properties, doc.sliceString(first.from, last.to), ends),
    block: true,
  }).range(first.from, last.to);
}
