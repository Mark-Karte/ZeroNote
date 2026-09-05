import { describe, expect, it } from 'vitest';
import { readableColumn, wrapFor } from '../src/editor/readable';

/**
 * Читаемая ширина (задача 58, Р-156).
 *
 * Правил два, и оба легко нарушить не подумав: колонка бывает только
 * у markdown, а перенос она включает сама.
 */

const md = { markdown: true };
const code = { markdown: false };

describe('колонка', () => {
  it('включается у markdown', () => {
    expect(readableColumn({ wrap: false, readableWidth: true, ...md })).toBe(true);
  });

  /**
   * В коде длина строки — часть смысла: там выравнивают продолжения,
   * таблицы и комментарии по столбцам. Колонка в восемьдесят знаков резала
   * бы их посередине, и это была бы не читаемость, а порча вида.
   */
  it('не включается у кода, даже когда настройка включена', () => {
    expect(readableColumn({ wrap: false, readableWidth: true, ...code })).toBe(false);
  });

  it('выключается настройкой', () => {
    expect(readableColumn({ wrap: false, readableWidth: false, ...md })).toBe(false);
  });
});

describe('перенос', () => {
  it('идёт за общей настройкой у кода', () => {
    expect(wrapFor({ wrap: true, readableWidth: true, ...code })).toBe(true);
    expect(wrapFor({ wrap: false, readableWidth: true, ...code })).toBe(false);
  });

  /**
   * Главное правило задачи: **колонка включает перенос**, даже когда общая
   * настройка его выключает. Без переноса абзац — одна длинная строка,
   * которая уходит за правый край колонки; колонка, которую текст не
   * замечает, — не колонка, а отступ слева.
   */
  it('включается колонкой, даже если общая настройка выключена', () => {
    expect(wrapFor({ wrap: false, readableWidth: true, ...md })).toBe(true);
  });

  it('у markdown без колонки остаётся за настройкой', () => {
    expect(wrapFor({ wrap: false, readableWidth: false, ...md })).toBe(false);
    expect(wrapFor({ wrap: true, readableWidth: false, ...md })).toBe(true);
  });
});
