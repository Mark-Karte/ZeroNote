import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { EditorState, Extension } from '@codemirror/state';

/**
 * Подсказка имён заметок после `[[` (решение Р-132).
 *
 * Это **не автодополнение**, и разница не в словах. Источник — наш индекс
 * файлов проекта, тот же, что у быстрого открытия; предлагается имя файла,
 * а не конструкция языка; включается на два знака `[[` и только в markdown.
 * Подсказок по содержимому кода не было и не будет — граница первого круга
 * остаётся на месте, и её стережёт `tests/brackets.test.ts`.
 *
 * Здесь только разбор текста вокруг курсора и составление вставки: список,
 * его вид и выбор живут выше, в `state/suggest` и `ui/Suggest.svelte`.
 * Редактор не должен знать ни про индекс, ни про всплывающие окна.
 */

/** Место, в котором сейчас набирается ссылка. */
export interface LinkContext {
  /** Позиция сразу за `[[`. */
  from: number;
  /** Позиция курсора. */
  to: number;
  /** Что набрано между `[[` и курсором. */
  query: string;
  /** Сразу за курсором стоит `]]` — закрывать ссылку не надо. */
  closed: boolean;
}

const OPEN = '[[';
const CLOSE = ']]';

/**
 * Знаки, после которых подсказывать нечего.
 *
 * `#` открывает раздел, `|` — подпись: и то и другое к именам файлов
 * отношения не имеет, а подсказка имени после решётки предлагала бы
 * не то, что человек набирает. Скобки означают, что ссылка уже кончилась
 * или началась заново. Перевод строки — что `[[` осталось на строке выше:
 * ссылка не переносится, и её разбор в `wikilinks.ts` тоже не пускает
 * перевод внутрь.
 */
const STOP = /[[\]#|\n]/;

/**
 * Сколько знаков перед курсором осматривается.
 *
 * Ограничение не украшение, а инвариант 6. Строкой здесь пользоваться нельзя:
 * файл, в котором весь текст — одна строка на мегабайты, для редактора этого
 * класса обычное дело, и взять её целиком на каждое нажатие значило бы
 * копировать мегабайт за нажатие. Та же причина, по которой столбец считается
 * в единицах UTF-16 (Р-101).
 *
 * Двести знаков — с запасом: за ними имя заметки, а не роман. Ссылка длиннее
 * подсказки не получит, и это честнее, чем незаметная задержка ввода.
 */
const LOOKBACK = 200;

/**
 * Набирается ли сейчас ссылка, и если да — что именно.
 *
 * Осматривается ограниченный кусок текста перед курсором, а не строка:
 * см. `LOOKBACK`. Границу строки стережёт перевод строки в `STOP` —
 * отдельная проверка ему не нужна.
 */
export function linkContextAt(state: EditorState): LinkContext | null {
  const { main } = state.selection;
  // Выделение — не набор. И при нескольких курсорах подсказывать некому:
  // вставка ушла бы в один из них, а остальные остались бы как были.
  if (!main.empty || state.selection.ranges.length > 1) return null;

  const start = Math.max(0, main.head - LOOKBACK);
  const before = state.doc.sliceString(start, main.head);

  const at = before.lastIndexOf(OPEN);
  if (at < 0) return null;

  const query = before.slice(at + OPEN.length);
  if (STOP.test(query)) return null;

  const after = state.doc.sliceString(
    main.head,
    Math.min(state.doc.length, main.head + CLOSE.length),
  );

  return {
    from: start + at + OPEN.length,
    to: main.head,
    query,
    closed: after === CLOSE,
  };
}

/** Правка, которой выбранное имя становится ссылкой. */
export interface Insertion {
  from: number;
  to: number;
  insert: string;
  /** Куда встаёт курсор — всегда за закрывающими скобками. */
  cursor: number;
}

/**
 * Что вставить вместо набранного.
 *
 * Закрывающие скобки дописываются, только если их нет. При включённом
 * автозакрытии (`[editor] auto_close`) они появляются сами в момент
 * набора `[[`, и дописать вторую пару значило бы оставить `]]]]` посреди
 * текста — то есть испортить ссылку, которую только что подсказали.
 */
export function insertionFor(context: LinkContext, target: string): Insertion {
  return {
    from: context.from,
    to: context.to,
    insert: context.closed ? target : target + CLOSE,
    cursor: context.from + target.length + CLOSE.length,
  };
}

/**
 * Сообщать наверх, что происходит вокруг курсора.
 *
 * Расширение намеренно бессловесное: оно не решает, показывать ли список,
 * не ходит в индекс и не знает про настройки. Всё это — дело вызывающего.
 *
 * Потеря фокуса гасит подсказку: список, висящий над текстом, в который
 * никто не печатает, читается как чужое окно — та же причина, по которой
 * закрывается контекстное меню.
 */
export function linkSuggestions(
  report: (context: LinkContext | null, view: EditorView) => void,
): Extension {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged && !update.selectionSet && !update.focusChanged) return;
    report(update.view.hasFocus ? linkContextAt(update.state) : null, update.view);
  });
}
