import type { EditorView } from '@codemirror/view';

/**
 * Текущее представление редактора.
 *
 * Экземпляр один на окно (решение Р-023), и командам правки нужен доступ
 * к нему из кода, который не является компонентом. Обычная переменная, а не
 * руна: интерфейс от неё не зависит, менять его вид она не должна.
 */
let current: EditorView | null = null;

export function setEditorView(view: EditorView | null): void {
  current = view;
}

export function editorView(): EditorView | null {
  return current;
}
