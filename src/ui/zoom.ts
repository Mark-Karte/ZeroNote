/**
 * Масштаб показа картинки.
 *
 * Ступенями, а не плавно: плавный масштаб от колеса требует и плавной
 * прокрутки к точке под указателем, иначе картинка уезжает из-под курсора.
 * Ступени же дают предсказуемые «сто процентов» — то единственное значение,
 * ради которого масштаб и трогают.
 */

/** `fit` — вписать в окно, но не растягивать сверх настоящего размера. */
export type Scale = number | 'fit';

export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

const MIN = ZOOM_STEPS[0];
const MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

/** Размер в точках. */
export interface Size {
  width: number;
  height: number;
}

/**
 * Следующая ступень в заданную сторону.
 *
 * `current` — масштаб, который человек видит, а не выбранный: у «вписать»
 * он зависит от размера окна, и шаг обязан идти от увиденного, иначе первое
 * же нажатие увело бы картинку не туда.
 */
export function stepFrom(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    // Строго больше: на точном совпадении со ступенью шаг иначе стоял бы на месте.
    return ZOOM_STEPS.find((step) => step > current + 1e-6) ?? MAX;
  }

  const smaller = ZOOM_STEPS.filter((step) => step < current - 1e-6);
  return smaller.length > 0 ? smaller[smaller.length - 1]! : MIN;
}

/**
 * Во сколько раз картинка показана сейчас.
 *
 * У «вписать» это отношение показанного размера к настоящему, и больше
 * единицы оно не бывает: растягивать маленькую картинку на всё окно мы
 * не будем — значок в шестнадцать точек, раздутый до окна, это каша
 * из квадратов, а не разглядывание.
 */
export function effectiveScale(scale: Scale, natural: Size, available: Size): number {
  if (scale !== 'fit') return scale;
  if (natural.width <= 0 || natural.height <= 0) return 1;
  if (available.width <= 0 || available.height <= 0) return 1;

  return Math.min(
    1,
    available.width / natural.width,
    available.height / natural.height,
  );
}

/**
 * Подпись масштаба для строки состояния.
 *
 * У «вписать» числа нет намеренно: оно зависит от размера окна и менялось бы
 * при каждом перетаскивании края — читать такую подпись невозможно, и это
 * ровно тот довод, по которому не измеряется ширина панели поиска (Р-164).
 */
export function scaleLabel(scale: Scale): string {
  return scale === 'fit' ? 'по окну' : `${Math.round(scale * 100)} %`;
}
