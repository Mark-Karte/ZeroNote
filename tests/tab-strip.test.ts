import { describe, expect, it } from 'vitest';
import { emptyDoubleClick, revealShift } from '../src/ui/tab-strip';

/** Серия из двух нажатий и двойной щелчок в конце — как их шлёт вебвью. */
function doubleClick(first: boolean, second: boolean): boolean {
  const gesture = emptyDoubleClick();
  gesture.press(1, first);
  gesture.press(2, second);
  return gesture.fires(second);
}

describe('двойной щелчок по полосе вкладок', () => {
  it('по пустому месту — новый файл', () => {
    expect(doubleClick(true, true)).toBe(true);
  });

  it('по вкладке — ничего', () => {
    expect(doubleClick(false, false)).toBe(false);
  });

  /**
   * Дефект, ради которого написан модуль: первое нажатие по крестику
   * последней вкладки её закрывает, второе приходится на опустевшую
   * полосу. Новый файл на месте только что закрытого — не то, чего ждут.
   */
  it('по крестику последней вкладки — ничего', () => {
    expect(doubleClick(false, true)).toBe(false);
  });

  /** Серия исчерпана: тройной щелчок не создаёт второй файл. */
  it('один файл на серию', () => {
    const gesture = emptyDoubleClick();
    gesture.press(1, true);
    gesture.press(2, true);
    expect(gesture.fires(true)).toBe(true);
    gesture.press(3, true);
    expect(gesture.fires(true)).toBe(false);
  });

  it('новая серия начинается заново', () => {
    const gesture = emptyDoubleClick();
    gesture.press(1, false);
    gesture.press(2, true);
    expect(gesture.fires(true)).toBe(false);

    gesture.press(1, true);
    gesture.press(2, true);
    expect(gesture.fires(true)).toBe(true);
  });
});

/** Полоса от 100 до 500 на экране. */
const STRIP = { left: 100, right: 500 };

describe('активная вкладка видна целиком', () => {
  it('видимая вкладка ничего не двигает', () => {
    expect(revealShift(STRIP, { left: 200, right: 300 })).toBe(0);
    expect(revealShift(STRIP, { left: 100, right: 500 })).toBe(0);
  });

  /** Дефект, найденный живой проверкой: «+» создавал вкладку за краем. */
  it('вкладка за правым краем подтягивается к нему', () => {
    expect(revealShift(STRIP, { left: 560, right: 670 })).toBe(170);
  });

  it('вкладка за левым краем подтягивается к нему', () => {
    expect(revealShift(STRIP, { left: 20, right: 130 })).toBe(-80);
  });

  /** Шире полосы — к левому краю: там значок и имя. */
  it('вкладка шире полосы прижимается левым краем', () => {
    expect(revealShift(STRIP, { left: 300, right: 800 })).toBe(200);
  });
});
