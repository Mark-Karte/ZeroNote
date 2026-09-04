import { editorView } from '../editor/current';
import { goToLine } from '../editor/commands';
import { askInput } from '../state/modal.svelte';

/** Ctrl+G — переход к строке по номеру. */
export async function goToLineDialog(): Promise<void> {
  const view = editorView();
  if (!view) return;

  const total = view.state.doc.lines;
  const current = view.state.doc.lineAt(view.state.selection.main.head).number;

  const answer = await askInput(
    'Перейти к строке',
    `Всего строк: ${total}`,
    String(current),
    'Перейти',
  );
  if (answer === null) return;

  const line = Number.parseInt(answer.trim(), 10);
  // Ввод не числом — не повод ругаться: просто ничего не делаем.
  if (!Number.isFinite(line)) return;

  goToLine(view, line);
}
