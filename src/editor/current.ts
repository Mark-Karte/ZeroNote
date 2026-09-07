import type { EditorView } from '@codemirror/view';
import { layout } from '../state/panes.svelte';

/**
 * Представления редактора по областям (Р-208).
 *
 * Представлений столько, сколько областей на экране, и у каждой своё.
 * Командам правки нужен доступ к «текущему» из кода, который не является
 * компонентом, и «текущее» — это представление активной области (Р-210).
 *
 * Обычная `Map`, а не руна: интерфейс от неё не зависит, менять его вид она
 * не должна. Но `layout.activePane` — руна, и ответ `editorView()` едет
 * за фокусом сам.
 *
 * Правило для всего фронтенда: **ни одна команда не хранит представление
 * дольше одного вызова.** Кто сохранил ссылку, у того после смены фокуса
 * окажется не та область.
 */
const views = new Map<number, EditorView>();

export function setEditorView(pane: number, view: EditorView | null): void {
  if (view) {
    views.set(pane, view);
  } else {
    views.delete(pane);
  }
}

/** Представление активной области. `null` — в ней не текст или её нет. */
export function editorView(): EditorView | null {
  return views.get(layout.activePane) ?? null;
}

export function editorViewOf(pane: number): EditorView | null {
  return views.get(pane) ?? null;
}
