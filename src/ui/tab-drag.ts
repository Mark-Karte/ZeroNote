/**
 * Куда переставить перетаскиваемую вкладку.
 *
 * Вынесено из компонента ради теста: здесь уже был дефект, из-за которого
 * обычный щелчок переставлял вкладку.
 *
 * Ошибочный подход — «над какой вкладкой сейчас курсор». Он ломается на самой
 * перетаскиваемой вкладке: стоит курсору оказаться правее её середины, как он
 * указывает на следующее место, и вкладка уезжает от простого нажатия.
 *
 * Правильный — «пересёк ли курсор середину СОСЕДНЕЙ вкладки». Шаг всегда на
 * одну позицию: так перестановка предсказуема и порядок не скачет.
 */

export interface TabBox {
  id: number;
  left: number;
  width: number;
}

/** Новый индекс или `null`, если двигать некуда и незачем. */
export function nextIndex(boxes: TabBox[], id: number, clientX: number): number | null {
  const current = boxes.findIndex((box) => box.id === id);
  if (current < 0) return null;

  const previous = boxes[current - 1];
  if (previous && clientX < previous.left + previous.width / 2) {
    return current - 1;
  }

  const following = boxes[current + 1];
  if (following && clientX > following.left + following.width / 2) {
    return current + 1;
  }

  return null;
}
