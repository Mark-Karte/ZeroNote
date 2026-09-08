import { beforeEach, describe, expect, it } from 'vitest';
import {
  arrivedAt,
  canGoBack,
  canGoForward,
  configureHistory,
  goBack,
  goForward,
  history,
  jumped,
  resetHistory,
  type Place,
} from '../src/state/history.svelte';

/**
 * История мест курсора (задача 85).
 *
 * Правила здесь легко нарушить не подумав, а на живом окне такое ловится
 * плохо: «назад» либо возвращает не туда, либо не возвращает вовсе, и понять,
 * что именно сломалось, по одному нажатию невозможно. Поэтому модуль ничего
 * не знает про вкладки, а тест подставляет ему выдуманный мир.
 */

/** Выдуманный мир: где какие вкладки и где в них курсор. */
let world: Map<number, number>;
let visited: Place[];

function place(tab: number, pane: number, pos: number): Place {
  return { tab, pane, pos };
}

beforeEach(() => {
  world = new Map([
    [1, 100],
    [2, 200],
    [3, 300],
  ]);
  visited = [];
  resetHistory();
  configureHistory({
    cursorOf: (target) => world.get(target.tab) ?? null,
    goTo: (target) => {
      visited.push(target);
      world.set(target.tab, target.pos);
    },
  });
});

describe('запись мест', () => {
  it('переход в другую вкладку кладёт прежнее место в «назад»', () => {
    arrivedAt(place(1, 1, 10));
    expect(canGoBack()).toBe(false);

    arrivedAt(place(2, 1, 20));

    expect(canGoBack()).toBe(true);
    // Позиция берётся сегодняшняя, а не запомненная: курсор в той вкладке
    // жил своей жизнью, пока мы на неё смотрели.
    expect(history.back).toEqual([place(1, 1, 100)]);
  });

  /**
   * Перемещение внутри той же вкладки записью не считается: для него есть
   * порог в строках, и решает его не этот модуль.
   */
  it('движение внутри вкладки записи не делает', () => {
    arrivedAt(place(1, 1, 10));
    arrivedAt(place(1, 1, 400));

    expect(canGoBack()).toBe(false);
  });

  /** Один файл в двух областях — два разных места (Р-209). */
  it('переход в другую область той же вкладки — тоже место', () => {
    arrivedAt(place(1, 1, 10));
    arrivedAt(place(1, 2, 10));

    expect(history.back).toEqual([place(1, 1, 100)]);
  });

  it('дальний прыжок внутри файла кладёт место, откуда прыгнули', () => {
    arrivedAt(place(1, 1, 10));
    jumped(place(1, 1, 10), place(1, 1, 900));

    expect(history.back).toEqual([place(1, 1, 10)]);
  });

  it('одно и то же место подряд не удваивается', () => {
    arrivedAt(place(1, 1, 10));
    jumped(place(1, 1, 100), place(1, 1, 900));
    jumped(place(1, 1, 100), place(1, 1, 950));

    expect(history.back).toHaveLength(1);
  });
});

describe('ходьба по истории', () => {
  it('назад возвращает в прежнее место и открывает путь вперёд', () => {
    arrivedAt(place(1, 1, 10));
    arrivedAt(place(2, 1, 20));

    expect(goBack()).toBe(true);

    expect(visited).toEqual([place(1, 1, 100)]);
    expect(canGoBack()).toBe(false);
    expect(canGoForward()).toBe(true);
  });

  it('вперёд возвращает туда, откуда ушли назад', () => {
    arrivedAt(place(1, 1, 10));
    arrivedAt(place(2, 1, 20));
    goBack();

    expect(goForward()).toBe(true);
    expect(visited.at(-1)).toEqual(place(2, 1, 200));
  });

  /**
   * Главное правило обоих стеков: новый переход стирает путь вперёд.
   * Так ведёт себя браузер, и по той же причине — вперёд ведёт туда,
   * где человек уже не был.
   */
  it('новый переход после «назад» стирает путь вперёд', () => {
    arrivedAt(place(1, 1, 10));
    arrivedAt(place(2, 1, 20));
    goBack();
    expect(canGoForward()).toBe(true);

    arrivedAt(place(3, 1, 30));

    expect(canGoForward()).toBe(false);
  });

  it('идти некуда — говорит об этом, а не притворяется', () => {
    expect(goBack()).toBe(false);
    expect(goForward()).toBe(false);
  });

  /**
   * Закрытая вкладка пропускается молча: иначе «назад» упиралось бы
   * в пустоту и требовало нажатия за каждый закрытый файл.
   */
  it('места закрытых вкладок пропускаются', () => {
    arrivedAt(place(1, 1, 10));
    arrivedAt(place(2, 1, 20));
    arrivedAt(place(3, 1, 30));

    world.delete(2);

    expect(goBack()).toBe(true);
    expect(visited).toEqual([place(1, 1, 100)]);
  });

  it('когда все места мертвы, назад не идёт никуда', () => {
    arrivedAt(place(1, 1, 10));
    arrivedAt(place(2, 1, 20));
    world.delete(1);

    expect(goBack()).toBe(false);
    expect(visited).toEqual([]);
  });
});
