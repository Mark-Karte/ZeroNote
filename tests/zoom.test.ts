import { describe, expect, it } from 'vitest';
import { effectiveScale, scaleLabel, stepFrom, ZOOM_STEPS } from '../src/ui/zoom';

describe('масштаб картинки', () => {
  describe('ступени', () => {
    it('идут вверх и вниз по списку', () => {
      expect(stepFrom(1, 1)).toBe(1.5);
      expect(stepFrom(1, -1)).toBe(0.75);
      expect(stepFrom(0.5, 1)).toBe(0.75);
    });

    /**
     * Шаг от значения, точно совпавшего со ступенью, обязан сдвинуться.
     * Иначе нажатие «увеличить» на ста процентах не делало бы ничего.
     */
    it('со ступени сдвигаются, а не стоят на месте', () => {
      // Края не в счёт: там шаг упирается, и это проверяется ниже отдельно.
      for (const step of ZOOM_STEPS.slice(1, -1)) {
        expect(stepFrom(step, 1), `вверх от ${step}`).not.toBe(step);
        expect(stepFrom(step, -1), `вниз от ${step}`).not.toBe(step);
      }
    });

    it('упираются в края и не уходят за них', () => {
      const first = ZOOM_STEPS[0];
      const last = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

      expect(stepFrom(first, -1)).toBe(first);
      expect(stepFrom(last, 1)).toBe(last);
      expect(stepFrom(0.001, -1)).toBe(first);
      expect(stepFrom(99, 1)).toBe(last);
    });

    /** Шаг от «между ступенями» — к соседней, а не к началу списка. */
    it('от промежуточного значения идут к соседней ступени', () => {
      expect(stepFrom(0.63, 1)).toBe(0.75);
      expect(stepFrom(0.63, -1)).toBe(0.5);
    });
  });

  describe('вписать в окно', () => {
    it('уменьшает то, что не влезло', () => {
      const scale = effectiveScale(
        'fit',
        { width: 2000, height: 1000 },
        { width: 1000, height: 1000 },
      );
      expect(scale).toBe(0.5);
    });

    it('считает по тесной стороне', () => {
      const scale = effectiveScale(
        'fit',
        { width: 1000, height: 2000 },
        { width: 1000, height: 500 },
      );
      expect(scale).toBe(0.25);
    });

    /**
     * Маленькая картинка не растягивается: значок в шестнадцать точек,
     * раздутый до окна, — это каша из квадратов, а не разглядывание.
     */
    it('не растягивает картинку меньше окна', () => {
      const scale = effectiveScale(
        'fit',
        { width: 16, height: 16 },
        { width: 1000, height: 800 },
      );
      expect(scale).toBe(1);
    });

    it('выбранный масштаб отдаёт как есть', () => {
      expect(
        effectiveScale(2, { width: 100, height: 100 }, { width: 50, height: 50 }),
      ).toBe(2);
    });

    /** Размеры ещё не известны — показываем как есть, а не делим на ноль. */
    it('без размеров возвращает единицу', () => {
      expect(effectiveScale('fit', { width: 0, height: 0 }, { width: 10, height: 10 })).toBe(1);
      expect(effectiveScale('fit', { width: 10, height: 10 }, { width: 0, height: 0 })).toBe(1);
    });
  });

  /**
   * У «вписать» числа в подписи нет намеренно: оно зависит от размера окна
   * и менялось бы при каждом перетаскивании края. Тот же довод, по которому
   * не измеряется ширина панели поиска (Р-164).
   */
  describe('подпись', () => {
    it('у «вписать» без числа, у остального в процентах', () => {
      expect(scaleLabel('fit')).toBe('по окну');
      expect(scaleLabel(1)).toBe('100 %');
      expect(scaleLabel(0.25)).toBe('25 %');
      expect(scaleLabel(4)).toBe('400 %');
    });
  });
});
