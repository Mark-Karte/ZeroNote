import { describe, expect, it } from 'vitest';
import { nextIndex, type TabBox } from '../src/ui/tab-drag';

/**
 * Три вкладки по 100 пикселей: 0..100, 100..200, 200..300.
 * Середины — 50, 150, 250.
 */
const BOXES: TabBox[] = [
  { id: 1, left: 0, width: 100 },
  { id: 2, left: 100, width: 100 },
  { id: 3, left: 200, width: 100 },
];

describe('перенос вкладки', () => {
  /**
   * Дефект, ради которого написан этот тест: курсор правее середины САМОЙ
   * нажатой вкладки не должен ничего двигать. Иначе обычный щелчок по правой
   * половине вкладки переставляет её.
   */
  it('нажатие в пределах своей вкладки ничего не двигает', () => {
    for (const x of [101, 150, 199]) {
      expect(nextIndex(BOXES, 2, x), `курсор на ${x}`).toBeNull();
    }
  });

  it('двигает влево после пересечения середины левого соседа', () => {
    expect(nextIndex(BOXES, 2, 51)).toBeNull();
    expect(nextIndex(BOXES, 2, 49)).toBe(0);
  });

  it('двигает вправо после пересечения середины правого соседа', () => {
    expect(nextIndex(BOXES, 2, 249)).toBeNull();
    expect(nextIndex(BOXES, 2, 251)).toBe(2);
  });

  /** За край списка двигать некуда. */
  it('крайние вкладки не уезжают за границы', () => {
    // Первая, уведённая влево: слева соседа нет.
    expect(nextIndex(BOXES, 1, -500)).toBeNull();
    // Последняя, уведённая вправо: справа соседа нет.
    expect(nextIndex(BOXES, 3, 5000)).toBeNull();
    // А внутрь списка обе двигаются как обычно.
    expect(nextIndex(BOXES, 1, 5000)).toBe(1);
    expect(nextIndex(BOXES, 3, -500)).toBe(1);
  });

  it('шаг всегда на одну позицию, как бы далеко ни увели курсор', () => {
    expect(nextIndex(BOXES, 1, 5000)).toBe(1);
  });

  it('неизвестная вкладка не роняет расчёт', () => {
    expect(nextIndex(BOXES, 99, 150)).toBeNull();
    expect(nextIndex([], 1, 150)).toBeNull();
  });

  it('одна вкладка никуда не двигается', () => {
    const single: TabBox[] = [{ id: 1, left: 0, width: 100 }];
    expect(nextIndex(single, 1, -100)).toBeNull();
    expect(nextIndex(single, 1, 900)).toBeNull();
  });
});
