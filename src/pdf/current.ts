/**
 * Текущий показ PDF.
 *
 * Тот же приём, что у `editor/current.ts`, и по той же причине: показ живёт
 * в компоненте, а команда «перейти к странице» — обычная функция в реестре,
 * и достучаться до показа ей больше неоткуда. Экземпляр один на окно: вкладка
 * с PDF на экране бывает только одна.
 */
export interface PdfHandle {
  /** Прокрутить к странице, считая с единицы. */
  goToPage(page: number): void;
}

let current: PdfHandle | null = null;

export function setPdfView(handle: PdfHandle | null): void {
  current = handle;
}

export function pdfView(): PdfHandle | null {
  return current;
}
