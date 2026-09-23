import { describe, expect, it } from 'vitest';

import { contrast, parseHex } from '../src/theme/contrast';

/**
 * Контраст по WCAG 2. Опорные числа — те же, что у теста читаемости тем
 * в ядре (`theme/mod.rs`): формула одна, копий две, и расходиться им нельзя.
 */
describe('контраст', () => {
  it('чёрное на белом — 21:1, одинаковые — 1:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(contrast('#808080', '#808080')).toBeCloseTo(1, 5);
  });

  it('порядок цветов не важен', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 2);
  });

  it('серое на сером ниже порога текста — как в тесте ядра', () => {
    expect(contrast('#808080', '#9a9a9a')!).toBeLessThan(4.5);
  });

  it('короткая запись цвета читается', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#ff8800')).toEqual([255, 136, 0]);
  });

  it('не цвет — не ответ, а не ноль', () => {
    expect(parseHex('var(--zn-color-accent)')).toBeNull();
    expect(contrast('оранжевый', '#ffffff')).toBeNull();
  });
});
