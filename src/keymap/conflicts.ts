/**
 * Что уже занимает сочетание.
 *
 * Редактор клавиш обязан спросить об этом до записи. Молча отнять сочетание
 * у другой команды — значит сломать её так, что человек узнает об этом
 * через неделю и не свяжет одно с другим.
 *
 * Занятость бывает трёх видов, и все три надо назвать вслух.
 */

import { t } from '../l10n';

export type ConflictKind = 'command' | 'editor' | 'webview';

export interface Conflict {
  kind: ConflictKind;
  /** Что именно потеряется. Уже человеческим языком. */
  what: string;
}

/**
 * Сочетания, которые приносит сам редактор (Р-122).
 *
 * Их нет в реестре, и потому обычная проверка на занятость их не видит.
 * Но наш диспетчер стоит на перехвате: назначив сюда свою команду,
 * пользователь отберёт у редактора работающее движение — и не поймёт, почему
 * `Alt+↑` перестал двигать строку.
 *
 * Список ведётся руками и повторяет таблицу из `DESIGN.md`, раздел 8.
 * Автоматически его не собрать: он живёт внутри чужой библиотеки.
 */
function editorAction(binding: string): string | null {
  // Выбором, а не таблицей модуля: строка берётся на языке окна при показе,
  // а ключ пишется буквально — иначе тест не сверит его с таблицей (Р-314).
  switch (binding) {
    case 'alt+up':
      return t('conflict.editor.move-up');
    case 'alt+down':
      return t('conflict.editor.move-down');
    case 'shift+alt+up':
      return t('conflict.editor.copy-up');
    case 'shift+alt+down':
      return t('conflict.editor.copy-down');
    case 'ctrl+alt+up':
      return t('conflict.editor.cursor-up');
    case 'ctrl+alt+down':
      return t('conflict.editor.cursor-down');
    case 'ctrl+bracketleft':
      return t('conflict.editor.outdent');
    case 'ctrl+bracketright':
      return t('conflict.editor.indent');
    case 'ctrl+enter':
      return t('conflict.editor.line-below');
    case 'ctrl+i':
      return t('conflict.editor.expand');
    case 'ctrl+m':
      return t('conflict.editor.tab-focus');
    case 'alt+l':
      return t('conflict.editor.select-line');
    case 'alt+a':
      return t('conflict.editor.block-comment');
    case 'escape':
      return t('conflict.editor.single-cursor');
    default:
      return null;
  }
}

/**
 * Сочетания, которые выполняет сам вебвью (Р-108).
 *
 * Буфер обмена мы намеренно не перехватываем: вебвью делает это правильно,
 * а наше подражание вышло бы хуже. Но перехват включается, как только
 * сочетание занимает **другая** команда, — и тогда копирование перестаёт
 * работать вовсе.
 */
function webviewAction(binding: string): string | null {
  switch (binding) {
    case 'ctrl+x':
      return t('conflict.webview.cut');
    case 'ctrl+c':
      return t('conflict.webview.copy');
    case 'ctrl+v':
      return t('conflict.webview.paste');
    default:
      return null;
  }
}

/**
 * Кто держит это сочетание сейчас, если держит.
 *
 * `bindings` — раскладка целиком, `titles` — названия команд по именам.
 * Своя же команда занятостью не считается: назначить команде то, что у неё
 * и так есть, — не столкновение, а ничего.
 */
export function conflictFor(
  binding: string,
  command: string,
  bindings: Record<string, string>,
  titles: Map<string, string>,
): Conflict | null {
  const owner = bindings[binding];
  if (owner !== undefined && owner !== command) {
    return { kind: 'command', what: titles.get(owner) ?? owner };
  }

  // Своё же сочетание вебвью выполняет мимо нас, и столкновения нет.
  const webview = webviewAction(binding);
  if (webview && owner !== command) {
    return { kind: 'webview', what: webview };
  }

  const editor = editorAction(binding);
  if (editor) {
    return { kind: 'editor', what: editor };
  }

  return null;
}

/** Вопрос, который задаётся человеку перед записью. */
export function conflictQuestion(conflict: Conflict, chord: string): string {
  switch (conflict.kind) {
    case 'command':
      return t('conflict.question.command', { chord, what: conflict.what });
    case 'webview':
      return t('conflict.question.webview', { chord, what: conflict.what });
    case 'editor':
      return t('conflict.question.editor', { chord, what: conflict.what });
  }
}

/**
 * Клавиши набора и движения по тексту: знак, пробел, перенос, отступ,
 * стирание, стрелки, начало и конец. Буквы и цифры — отдельной проверкой.
 */
const TYPING_KEYS = new Set([
  'enter',
  'space',
  'tab',
  'backspace',
  'delete',
  'left',
  'right',
  'up',
  'down',
  'home',
  'end',
  'pageup',
  'pagedown',
  'comma',
  'period',
  'slash',
  'backslash',
  'bracketleft',
  'bracketright',
  'semicolon',
  'quote',
  'backquote',
  'minus',
  'equal',
]);

/**
 * Что делать с нажатием, пойманным при назначении сочетания (С7 ревизии).
 *
 * `cancel` — Esc, назначение отменяется; `typing` — клавиша нужна набору,
 * назначать её нельзя; `take` — назначаем.
 *
 * Без Ctrl и Alt (с одним Shift — тоже: это заглавная буква и выделение)
 * клавиша набора сочетанием не бывает. Наш диспетчер стоит на перехвате
 * и гасит нажатие, у которого есть команда, — назначенный Enter закрывал
 * бы вкладку в любом тексте вместо новой строки, назначенная буква
 * переставала бы печататься. До задачи 142 назначалось всё, кроме Esc,
 * а проверка столкновений клавиш набора не видит: их никто не занимает.
 * F-клавиши и Insert тексту не нужны и стоят в умолчаниях без
 * модификаторов (F3, Shift+F2, F12).
 */
export function chordVerdict(binding: string): 'cancel' | 'typing' | 'take' {
  if (binding === 'escape') return 'cancel';

  const parts = binding.split('+');
  const key = parts[parts.length - 1] ?? '';
  if (parts.includes('ctrl') || parts.includes('alt')) return 'take';

  if (/^[a-z0-9]$/.test(key) || TYPING_KEYS.has(key)) return 'typing';
  return 'take';
}
