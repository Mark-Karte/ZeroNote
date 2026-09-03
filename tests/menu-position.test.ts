import { describe, expect, it } from 'vitest';
import { placeMenu } from '../src/ui/menu-position';

/**
 * Меню, уехавшее за край окна, выглядит как не открывшееся вовсе. Расчёт
 * положения поэтому вынесен из компонента и проверяется числами.
 */

const WINDOW = { width: 1000, height: 700 };
const MENU = { width: 200, height: 300 };

describe('положение меню от точки щелчка', () => {
  it('растёт вниз и вправо, когда помещается', () => {
    expect(placeMenu({ x: 100, y: 100 }, MENU, WINDOW)).toEqual({ left: 100, top: 100 });
  });

  it('переворачивается у правого края, а не сдвигается вдоль него', () => {
    // Сдвиг вдоль края накрыл бы то, по чему щёлкнули.
    expect(placeMenu({ x: 900, y: 100 }, MENU, WINDOW)).toEqual({ left: 700, top: 100 });
  });

  it('переворачивается у нижнего края', () => {
    expect(placeMenu({ x: 100, y: 600 }, MENU, WINDOW)).toEqual({ left: 100, top: 300 });
  });

  it('переворачивается по обеим осям сразу', () => {
    expect(placeMenu({ x: 950, y: 690 }, MENU, WINDOW)).toEqual({ left: 750, top: 390 });
  });

  it('оставляет поле у края окна', () => {
    // Ровно на границе: 992 + 200 не помещается даже без поля, значит переворот.
    expect(placeMenu({ x: 992, y: 8 }, MENU, WINDOW, 8)).toEqual({ left: 792, top: 8 });
  });

  it('не выходит за начало окна, когда переворачивать некуда', () => {
    // Щелчок у левого края: справа не помещается, слева места нет вовсе.
    const menu = { width: 200, height: 300 };
    expect(placeMenu({ x: 10, y: 10 }, menu, { width: 150, height: 700 }, 8)).toEqual({
      left: 8,
      top: 10,
    });
  });

  it('прижимается к началу, когда меню выше окна', () => {
    const tall = { width: 200, height: 900 };
    expect(placeMenu({ x: 100, y: 400 }, tall, WINDOW, 8)).toEqual({ left: 100, top: 8 });
  });

  /**
   * Случай, ради которого в расчёте стоит `Math.min`: меню помещается
   * по ширине, но точка щелчка так близка к правому краю, что «вправо»
   * не годится, а слева места ровно столько, сколько нужно.
   */
  it('не уводит правый край за окно при прижатии', () => {
    const wide = { width: 400, height: 100 };
    const placed = placeMenu({ x: 380, y: 10 }, wide, { width: 500, height: 700 }, 8);
    expect(placed.left + wide.width).toBeLessThanOrEqual(500 - 8);
  });
});
