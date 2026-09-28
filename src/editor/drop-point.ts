import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

/**
 * Точка броска файла в заметку (задача 147): куда ляжет ссылка.
 *
 * Своя, а не `dropCursor` CodeMirror: бросок из проводника ловит Tauri,
 * и событий перетаскивания вебвью не видит вовсе — каретка CodeMirror
 * не показалась бы ни разу. Точек две роли. `hover` — где сейчас
 * указатель, пока файл тянут. `pending` — куда лягут ссылки, пока файлы
 * копируются: копия большого файла идёт секунды, человек за это время
 * печатает, и место вставки едет вместе с правками, как закладка.
 */

interface Pending {
  id: number;
  pos: number;
}

interface Points {
  hover: number | null;
  pending: readonly Pending[];
}

// Наружу — ради проверок без окна; редактору хватает функций ниже.
export const setHover = StateEffect.define<number | null>();
export const hold = StateEffect.define<Pending>();
export const release = StateEffect.define<number>();

const clamp = (state: EditorState, pos: number): number => Math.max(0, Math.min(pos, state.doc.length));

const points = StateField.define<Points>({
  create: () => ({ hover: null, pending: [] }),
  update(value, tr) {
    let hover = value.hover === null ? null : tr.changes.mapPos(value.hover);
    let pending = value.pending.map((point) => ({ id: point.id, pos: tr.changes.mapPos(point.pos) }));
    for (const effect of tr.effects) {
      if (effect.is(setHover)) hover = effect.value === null ? null : clamp(tr.state, effect.value);
      if (effect.is(hold)) pending = [...pending, { id: effect.value.id, pos: clamp(tr.state, effect.value.pos) }];
      if (effect.is(release)) pending = pending.filter((point) => point.id !== effect.value);
    }
    return { hover, pending };
  },
});

class DropPoint extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const mark = document.createElement('span');
    mark.className = 'zn-drop-point';
    mark.setAttribute('aria-hidden', 'true');
    return mark;
  }
}

const mark = Decoration.widget({ widget: new DropPoint(), side: 1 });

function decorations(value: Points): DecorationSet {
  const at = [...value.pending.map((point) => point.pos)];
  if (value.hover !== null) at.push(value.hover);
  return Decoration.set(
    [...new Set(at)].sort((a, b) => a - b).map((pos) => mark.range(pos)),
  );
}

export function dropPoint(): Extension {
  return [points, EditorView.decorations.from(points, decorations)];
}

/** Показать, куда ляжет ссылка, пока файл тянут. `null` — убрать. */
export function showDropPoint(view: EditorView, pos: number | null): void {
  if (view.state.field(points, false)?.hover === pos) return;
  view.dispatch({ effects: setHover.of(pos) });
}

/** Запомнить место вставки, пока файлы копируются. */
export function holdDropPoint(view: EditorView, id: number, pos: number): void {
  view.dispatch({ effects: hold.of({ id, pos }) });
}

/**
 * Забрать запомненное место — сдвинутое правками, сделанными за время
 * копирования. `null` — его нет (представление пересоздано).
 */
export function takeDropPoint(view: EditorView, id: number): number | null {
  const point = view.state.field(points, false)?.pending.find((item) => item.id === id);
  view.dispatch({ effects: release.of(id) });
  return point ? point.pos : null;
}

/** Для проверок: где сейчас точки. */
export function dropPoints(state: EditorState): Points | null {
  return state.field(points, false) ?? null;
}
