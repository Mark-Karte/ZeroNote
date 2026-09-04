/**
 * Превращение нажатия в строку сочетания вида `ctrl+shift+d`.
 *
 * Клавиша берётся из `event.code`, а не из `event.key`, и это принципиально.
 * `event.key` зависит от раскладки: при русской раскладке клавиша D даёт
 * букву «в», и Ctrl+D перестал бы работать ровно тогда, когда пользователь
 * набирает русский текст. Notepad++ различает клавиши по их положению,
 * а не по нанесённой букве, — делаем так же.
 *
 * Обратная сторона: сочетание описывается латинскими буквами всегда, включая
 * файл `keymap.toml`. Это и правильно, и привычно.
 */

/** Клавиши с собственными именами: код → имя в сочетании. */
const NAMED: Record<string, string> = {
  Enter: 'enter',
  NumpadEnter: 'enter',
  Tab: 'tab',
  Escape: 'escape',
  Space: 'space',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  // Знаки препинания названы по положению клавиши, а не по нанесённому
  // знаку — по той же причине, по какой буквы берутся из `code`: сочетание
  // не должно зависеть от раскладки.
  //
  // До задачи 41 здесь была одна `Comma`, и всё остальное разбор нажатия
  // просто не видел. Значит, `Ctrl+/` нельзя было ни назначить, ни отнять
  // у редактора, а строки `ctrl+=` и `ctrl+-` в списке отнимаемых у вебвью
  // не совпадали ни с чем и молча не работали (Р-121).
  Comma: 'comma',
  Period: 'period',
  Slash: 'slash',
  Backslash: 'backslash',
  BracketLeft: 'bracketleft',
  BracketRight: 'bracketright',
  Semicolon: 'semicolon',
  Quote: 'quote',
  Backquote: 'backquote',
  Minus: 'minus',
  Equal: 'equal',
};

/**
 * Те же знаки для запасного пути, когда `code` пуст.
 *
 * Там раскладка уже вмешалась, и деться от этого некуда: клавиша сообщает
 * о себе только нанесённым знаком. Берём латинский набор — тот же, что
 * и в именах выше.
 */
const PUNCTUATION: Record<string, string> = {
  ',': 'comma',
  '.': 'period',
  '/': 'slash',
  '\\': 'backslash',
  '[': 'bracketleft',
  ']': 'bracketright',
  ';': 'semicolon',
  "'": 'quote',
  '`': 'backquote',
  '-': 'minus',
  '=': 'equal',
};

/** Только то, что нужно для расчёта: так функцию можно проверить тестом. */
export interface KeyLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Строка сочетания или `null`, если нажатие сочетанием быть не может —
 * например, нажали один модификатор.
 */
export function bindingOf(event: KeyLike): string | null {
  // Alt с цифрой на дополнительной клавиатуре — это не сочетание, а системный
  // ввод знака по коду: Alt+0151 даёт тире, Alt+0171 — открывающую кавычку.
  // Человек, пишущий по-русски, набирает так каждый день, и перехватить
  // первое же нажатие значило бы отобрать у него тире. Цифра в верхнем ряду
  // сочетанием остаётся: Windows различает эти клавиши, и Notepad++ тоже.
  if (event.altKey && /^Numpad\d$/.test(event.code)) return null;

  const key = fromCode(event.code) ?? fromKey(event.key);
  if (key === null) return null;

  let binding = '';
  if (event.ctrlKey) binding += 'ctrl+';
  if (event.altKey) binding += 'alt+';
  if (event.shiftKey) binding += 'shift+';
  return binding + key;
}

/** Как называется клавиша на подписи. Остальное пишется с большой буквы. */
const SHOWN: Record<string, string> = {
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  bracketleft: '[',
  bracketright: ']',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  minus: '-',
  equal: '=',
  escape: 'Esc',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
};

/**
 * Подпись сочетания для интерфейса: `ctrl+shift+p` → `Ctrl Shift P`.
 *
 * Плюсы убраны намеренно: в палитре подпись стоит плашкой, и разделители
 * внутри неё превращаются в шум. Порядок частей не меняется — он задан
 * при разборе, и подпись обязана совпадать с тем, что написано в
 * `keymap.toml`, иначе по ней нельзя будет найти строку в файле.
 */
export function labelOf(binding: string): string {
  return binding
    .split('+')
    .map((part) => SHOWN[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function fromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!.toLowerCase();

  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit) return digit[1]!;

  const fn = /^F(\d{1,2})$/.exec(code);
  if (fn) return `f${fn[1]}`;

  return NAMED[code] ?? null;
}

/**
 * Запасной путь, когда `code` пуст.
 *
 * Так бывает не только в тестах: пустой `code` приходит от экранных клавиатур,
 * программ переназначения клавиш, средств специальных возможностей и вообще
 * от любого источника, который не сообщает скан-код. Отказываться от сочетания
 * в таких случаях нельзя — пользователь нажал ровно то, что хотел.
 *
 * Кириллическая буква сюда не проходит намеренно: соответствие должно
 * оставаться независимым от раскладки, а не превращаться в неё при первой же
 * возможности.
 */
function fromKey(key: string | undefined): string | null {
  if (!key) return null;
  if (key === ' ') return 'space';
  if (key.length === 1 && /^[a-z0-9]$/i.test(key)) return key.toLowerCase();
  if (PUNCTUATION[key]) return PUNCTUATION[key];

  // Функциональные клавиши приходят в `key` тем же именем, что и в `code`.
  const fn = /^F(\d{1,2})$/.exec(key);
  if (fn) return `f${fn[1]}`;

  return NAMED[key] ?? null;
}
