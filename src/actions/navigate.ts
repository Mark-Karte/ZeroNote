import { editorView } from '../editor/current';
import { goToLine } from '../editor/commands';
import { askInput } from '../state/modal.svelte';
import { activeTab, type PdfState } from '../state/tabs.svelte';
import { pdfView } from '../pdf/current';
import { notify } from '../state/notices.svelte';
import { openSearch } from '../state/search.svelte';

/**
 * Ctrl+G — переход к строке, а над PDF к странице.
 *
 * Сочетание контекстное, как `Tab` (Р-115) и `F2` (Р-117): вопрос у человека
 * один и тот же — «отвези меня туда», — и разные сочетания на него были бы
 * разными названиями одного действия.
 */
export async function goToLineDialog(): Promise<void> {
  const pdf = activeTab()?.pdf ?? null;
  if (pdf) {
    await goToPageDialog(pdf);
    return;
  }

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

/** Переход к странице PDF. Зовётся и с Ctrl+G, и из строки состояния. */
export async function goToPageDialog(pdf: PdfState): Promise<void> {
  if (pdf.pages === 0) return;

  const answer = await askInput(
    'Перейти к странице',
    `Всего страниц: ${pdf.pages}`,
    String(pdf.page),
    'Перейти',
  );
  if (answer === null) return;

  const page = Number.parseInt(answer.trim(), 10);
  // Ввод не числом — не повод ругаться: просто ничего не делаем.
  if (!Number.isFinite(page)) return;

  pdfView()?.goToPage(page);
}

/**
 * Ctrl+F — поиск по тексту, и только по тексту.
 *
 * **Поиска по PDF нет** — решение владельца, закрывшее вопрос Р-181. Из трёх
 * возможных ответов худшим был «не ловить нажатие вовсе»: человек нажал,
 * ничего не случилось, и прочитал это как поломку. Поэтому отвечаем словами
 * и той же полосой, которой говорим обо всём остальном.
 */
export function findInTab(mode: 'find' | 'replace'): void {
  const tab = activeTab();

  if (tab && tab.editor === null) {
    notify(
      tab.pdf
        ? 'Поиска по PDF нет: ZeroNote его показывает, но не читает.'
        : 'Поиск работает по тексту — на этой вкладке искать нечего.',
    );
    return;
  }

  openSearch(mode);
}
