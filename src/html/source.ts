/**
 * Окно в исходник со смещениями документа (задача 108).
 *
 * Вывод HTML ходит по дереву разбора, а смещения у дерева — от начала
 * документа. Печать видит документ целиком, а превью таблицы — только
 * её кусок: копировать десять мегабайт заметки ради одной таблицы нельзя.
 * Окно хранит кусок и его начало и отвечает смещениями документа, так что
 * рендер не знает, целиком у него документ или нет.
 */
export class Source {
  constructor(
    private readonly text: string,
    /** Где в документе начинается кусок. */
    private readonly offset = 0,
  ) {}

  slice(from: number, to: number): string {
    return this.text.slice(from - this.offset, to - this.offset);
  }

  /** Знак на месте. За краями окна — пустая строка. */
  char(pos: number): string {
    return this.text[pos - this.offset] ?? '';
  }

  /** Первое вхождение не раньше `pos`. Не найдено — `-1`. */
  indexOf(search: string, pos: number): number {
    const found = this.text.indexOf(search, Math.max(0, pos - this.offset));
    return found < 0 ? -1 : found + this.offset;
  }

  /**
   * Последнее вхождение не позже `pos`. Не найдено — место сразу перед
   * окном: тогда `lastIndexOf('\n', …) + 1` даёт начало окна, то есть
   * начало строки там, где кусок начинается, — как и у целого документа.
   */
  lastIndexOf(search: string, pos: number): number {
    if (pos < this.offset) return this.offset - 1;
    const found = this.text.lastIndexOf(search, pos - this.offset);
    return found < 0 ? this.offset - 1 : found + this.offset;
  }
}
