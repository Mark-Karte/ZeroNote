/**
 * Что уже занимает сочетание.
 *
 * Редактор клавиш обязан спросить об этом до записи. Молча отнять сочетание
 * у другой команды — значит сломать её так, что человек узнает об этом
 * через неделю и не свяжет одно с другим.
 *
 * Занятость бывает трёх видов, и все три надо назвать вслух.
 */

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
const EDITOR_CHORDS: Record<string, string> = {
  'alt+up': 'переместить строку вверх',
  'alt+down': 'переместить строку вниз',
  'shift+alt+up': 'продублировать строку вверх',
  'shift+alt+down': 'продублировать строку вниз',
  'ctrl+alt+up': 'курсор строкой выше',
  'ctrl+alt+down': 'курсор строкой ниже',
  'ctrl+bracketleft': 'снять отступ',
  'ctrl+bracketright': 'добавить отступ',
  'ctrl+enter': 'пустая строка под текущей',
  'ctrl+i': 'расширить выделение по разбору',
  'ctrl+m': 'переключить действие Tab',
  'alt+l': 'выделить строку',
  'alt+a': 'закомментировать блоком',
  escape: 'свести курсоры к одному',
};

/**
 * Сочетания, которые выполняет сам вебвью (Р-108).
 *
 * Буфер обмена мы намеренно не перехватываем: вебвью делает это правильно,
 * а наше подражание вышло бы хуже. Но перехват включается, как только
 * сочетание занимает **другая** команда, — и тогда копирование перестаёт
 * работать вовсе.
 */
const WEBVIEW_CHORDS: Record<string, string> = {
  'ctrl+x': 'вырезать',
  'ctrl+c': 'копировать',
  'ctrl+v': 'вставить',
};

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
  if (WEBVIEW_CHORDS[binding] && owner !== command) {
    return { kind: 'webview', what: WEBVIEW_CHORDS[binding] };
  }

  if (EDITOR_CHORDS[binding]) {
    return { kind: 'editor', what: EDITOR_CHORDS[binding] };
  }

  return null;
}

/** Вопрос, который задаётся человеку перед записью. */
export function conflictQuestion(conflict: Conflict, chord: string): string {
  switch (conflict.kind) {
    case 'command':
      return (
        `Сейчас ${chord} — это «${conflict.what}».\n\n` +
        'Назначить сюда новую команду — значит отнять сочетание у неё: ' +
        'нажимать её будет нечем, но она останется в палитре и в меню.'
      );
    case 'webview':
      return (
        `Сейчас ${chord} — это «${conflict.what}», и делает это сам вебвью.\n\n` +
        'Заняв это сочетание, вы отключите его совсем — включая работу ' +
        'в полях ввода.'
      );
    case 'editor':
      return (
        `Сейчас ${chord} — это «${conflict.what}» в редакторе текста.\n\n` +
        'Этого сочетания нет в списке команд: его приносит сам редактор. ' +
        'Заняв его, вы отберёте у редактора это действие.'
      );
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
