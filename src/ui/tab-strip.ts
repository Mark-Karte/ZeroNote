/**
 * Расчёты полосы вкладок, вынесенные из компонента ради теста (задача 133).
 */

/**
 * Двойной щелчок по пустому месту полосы — новый файл.
 *
 * «Двойной щелчок пришёлся на пустое место» и «оба щелчка были по пустому
 * месту» — разные вещи. Двойной щелчок по крестику последней вкладки
 * первым нажатием её закрывает, и второе нажатие приходится уже
 * на опустевшую полосу. Проверка одного лишь второго щелчка создала бы
 * новый файл на месте только что закрытого.
 *
 * Что под указателем, решает компонент (`elementFromPoint`, а не цель
 * события: полоса захватывает указатель при нажатии на вкладку, и цель
 * щелчка тогда — сама полоса).
 */

/** Что на полосе не пустое место: вкладка и кнопки. */
export const NOT_EMPTY = '[data-tab-id], button';

export interface EmptyDoubleClick {
  /** Нажатие кнопки мыши: `count` — номер щелчка в серии (`detail`). */
  press(count: number, empty: boolean): void;
  /** Двойной щелчок: создавать ли файл. Серия после ответа исчерпана. */
  fires(empty: boolean): boolean;
}

export function emptyDoubleClick(): EmptyDoubleClick {
  // Начало серии запоминается по первому нажатию: до щелчка вкладка
  // ещё на месте, и её крестик виден под указателем.
  let startedEmpty = false;

  return {
    press(count, empty) {
      if (count === 1) startedEmpty = empty;
    },
    fires(empty) {
      const fire = startedEmpty && empty;
      startedEmpty = false;
      return fire;
    },
  };
}

/** Горизонтальные края прямоугольника на экране. */
export interface Span {
  left: number;
  right: number;
}

/**
 * На сколько пролистать полосу, чтобы активная вкладка была видна целиком.
 *
 * Полоса листается сама, а новая вкладка встаёт в конец: без этого
 * «+» при длинном ряду создавал вкладку за краем, и нажатие выглядело
 * пустым. Сдвиг наименьший: видимая вкладка не двигает ничего, а
 * вкладка шире полосы прижимается левым краем — там её значок и имя.
 */
export function revealShift(strip: Span, tab: Span): number {
  if (tab.left < strip.left) return tab.left - strip.left;
  if (tab.right > strip.right) {
    return Math.min(tab.right - strip.right, tab.left - strip.left);
  }
  return 0;
}
