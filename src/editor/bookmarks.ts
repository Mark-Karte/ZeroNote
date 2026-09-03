import { RangeSet, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { GutterMarker, type EditorView } from '@codemirror/view';

/**
 * Закладки на строках.
 *
 * Живут в состоянии редактора, а не рядом с ним, и это главное решение здесь:
 * `RangeSet` переносится через правку сам. Вставили десять строк выше —
 * закладка уехала вместе со своей строкой, а не осталась висеть на номере,
 * который теперь показывает совсем другое. Список номеров строк, хранимый
 * сбоку, пришлось бы поправлять руками на каждое изменение текста, и первая же
 * забытая правка сделала бы закладки бесполезными.
 *
 * Отсюда же бесплатно берётся переключение вкладок: `EditorState` у каждой
 * вкладки свой.
 */

class BookmarkMarker extends GutterMarker {
  /** Класс вешается на ячейку с номером строки — своего поля закладкам не надо. */
  override elementClass = 'zn-bookmark';
}

const marker = new BookmarkMarker();

/** Переключить закладку на строке, в которой стоит эта позиция. */
export const toggleBookmarkEffect = StateEffect.define<number>();

/** Снять все закладки. */
export const clearBookmarksEffect = StateEffect.define<null>();

export const bookmarkField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,

  update(set, tr) {
    if (tr.docChanged) {
      // Перенос через правку и приведение к началам строк одним действием:
      // после сдвига закладка может оказаться в середине строки, а ячейка
      // номера рисуется только по её началу — и метка просто пропала бы.
      set = normalize(tr.state, positions(set.map(tr.changes)));
    }

    for (const effect of tr.effects) {
      if (effect.is(toggleBookmarkEffect)) {
        const at = tr.state.doc.lineAt(effect.value).from;
        const now = positions(set);
        set = normalize(
          tr.state,
          now.includes(at) ? now.filter((p) => p !== at) : [...now, at],
        );
      } else if (effect.is(clearBookmarksEffect)) {
        set = RangeSet.empty;
      }
    }

    return set;
  },
});

/** Позиции закладок по возрастанию. */
export function positions(set: RangeSet<GutterMarker>): number[] {
  const out: number[] = [];
  for (const iter = set.iter(); iter.value !== null; iter.next()) {
    out.push(iter.from);
  }
  return out;
}

/** Номера строк с закладками — то, что уезжает в сессию. */
export function bookmarkLines(state: EditorState): number[] {
  return positions(state.field(bookmarkField, false) ?? RangeSet.empty).map(
    (at) => state.doc.lineAt(at).number,
  );
}

/** Собрать набор из позиций: по началам строк, без повторов и по порядку. */
function normalize(state: EditorState, at: number[]): RangeSet<GutterMarker> {
  const lines = new Set(at.map((pos) => state.doc.lineAt(pos).from));
  return RangeSet.of(
    [...lines].sort((a, b) => a - b).map((from) => marker.range(from)),
    true,
  );
}

/**
 * Расширение с закладками, восстановленными из сессии.
 *
 * Номера строк, а не позиции: файл могли поправить в другой программе, пока
 * приложение было закрыто, и номер переживает такую правку куда лучше, чем
 * смещение в знаках. Номер за концом файла отбрасывается — придумывать
 * строку, которой нет, незачем.
 */
export function bookmarks(lines: number[]) {
  return bookmarkField.init((state) =>
    normalize(
      state,
      lines
        .filter((number) => number >= 1 && number <= state.doc.lines)
        .map((number) => state.doc.line(number).from),
    ),
  );
}

/** Для поля номеров строк: какие ячейки пометить. */
export function bookmarkMarkers(state: EditorState): RangeSet<GutterMarker> {
  return state.field(bookmarkField, false) ?? RangeSet.empty;
}

export function toggleBookmark(view: EditorView): boolean {
  view.dispatch({ effects: toggleBookmarkEffect.of(view.state.selection.main.head) });
  return true;
}

export function clearBookmarks(view: EditorView): boolean {
  if (positions(bookmarkMarkers(view.state)).length === 0) return false;
  view.dispatch({ effects: clearBookmarksEffect.of(null) });
  return true;
}

/**
 * Куда перейдёт «следующая закладка».
 *
 * По кругу: за последней идёт первая. Так делает Notepad++, и это правильно —
 * иначе обход длинного файла упирается в конец и требует вспоминать, где
 * начало. Единственная закладка на строке курсора возвращает саму себя:
 * «перейти» к тому, где уже стоишь, — не ошибка, а честный ответ.
 */
export function nextBookmark(state: EditorState, forward: boolean): number | null {
  const all = positions(bookmarkMarkers(state));
  if (all.length === 0) return null;

  const here = state.doc.lineAt(state.selection.main.head).from;

  if (forward) {
    return all.find((at) => at > here) ?? all[0]!;
  }
  return [...all].reverse().find((at) => at < here) ?? all[all.length - 1]!;
}

function jump(view: EditorView, forward: boolean): boolean {
  const at = nextBookmark(view.state, forward);
  if (at === null) return false;

  view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  return true;
}

export const goToNextBookmark = (view: EditorView): boolean => jump(view, true);
export const goToPreviousBookmark = (view: EditorView): boolean => jump(view, false);

/** Есть ли закладка на строке курсора — для подписи пункта меню. */
export function bookmarkedHere(state: EditorState): boolean {
  const here = state.doc.lineAt(state.selection.main.head).from;
  return positions(bookmarkMarkers(state)).includes(here);
}
