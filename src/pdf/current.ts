import { layout } from '../state/panes.svelte';

/**
 * Показ PDF по областям.
 *
 * Тот же приём, что у `editor/current.ts`, и по той же причине: показ живёт
 * в компоненте, а команда «перейти к странице» — обычная функция в реестре,
 * и достучаться до показа ей больше неоткуда. С этапа 11 показов столько,
 * сколько областей показывают PDF (Р-208), и «текущий» — тот, что
 * в активной области.
 */
export interface PdfHandle {
  /** Прокрутить к странице, считая с единицы. */
  goToPage(page: number): void;
}

const handles = new Map<number, PdfHandle>();

export function setPdfView(pane: number, handle: PdfHandle | null): void {
  if (handle) {
    handles.set(pane, handle);
  } else {
    handles.delete(pane);
  }
}

export function pdfView(): PdfHandle | null {
  return handles.get(layout.activePane) ?? null;
}
