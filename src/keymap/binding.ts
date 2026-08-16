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
  const key = fromCode(event.code) ?? fromKey(event.key);
  if (key === null) return null;

  let binding = '';
  if (event.ctrlKey) binding += 'ctrl+';
  if (event.altKey) binding += 'alt+';
  if (event.shiftKey) binding += 'shift+';
  return binding + key;
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

  // Функциональные клавиши приходят в `key` тем же именем, что и в `code`.
  const fn = /^F(\d{1,2})$/.exec(key);
  if (fn) return `f${fn[1]}`;

  return NAMED[key] ?? null;
}
