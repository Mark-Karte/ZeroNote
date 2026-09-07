import { describe, expect, it } from 'vitest';
import { dropZone, insertIndex } from '../src/ui/pane-drop';
import { clampRatio } from '../src/ui/pane-size';

/** Область 400 на 200 в начале координат. */
const box = { left: 0, top: 0, width: 400, height: 200 };

describe('зона сброса', () => {
  it('середина — перенос в область', () => {
    expect(dropZone(box, 200, 100)).toBe('center');
    expect(dropZone(box, 150, 60)).toBe('center');
  });

  it('четверть у края — разделение с этой стороны', () => {
    expect(dropZone(box, 10, 100)).toBe('left');
    expect(dropZone(box, 390, 100)).toBe('right');
    expect(dropZone(box, 200, 10)).toBe('top');
    expect(dropZone(box, 200, 190)).toBe('bottom');
  });

  it('у угла побеждает ближний край', () => {
    // До левого края 10 из 400 (2,5 %), до верхнего 20 из 200 (10 %).
    expect(dropZone(box, 10, 20)).toBe('left');
    // До верхнего края 2 из 200 (1 %), до левого 30 из 400 (7,5 %).
    expect(dropZone(box, 30, 2)).toBe('top');
  });

  it('пустая область не делится', () => {
    expect(dropZone({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBe('center');
  });
});

describe('место в чужой полосе', () => {
  const tabs = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
    { left: 200, width: 100 },
  ];

  it('перед вкладкой, чья середина правее указателя', () => {
    expect(insertIndex(tabs, 20)).toBe(0);
    expect(insertIndex(tabs, 80)).toBe(1);
    expect(insertIndex(tabs, 160)).toBe(2);
  });

  it('за последней — в конец', () => {
    expect(insertIndex(tabs, 290)).toBe(3);
    expect(insertIndex(tabs, 999)).toBe(3);
    expect(insertIndex([], 50)).toBe(0);
  });
});

describe('предел доли', () => {
  it('держит обе стороны не уже наименьшего размера', () => {
    // 1000 px, предел 200: доля не ниже 0,2 и не выше 0,8.
    expect(clampRatio(0.05, 1000, 200)).toBe(0.2);
    expect(clampRatio(0.95, 1000, 200)).toBe(0.8);
    expect(clampRatio(0.5, 1000, 200)).toBe(0.5);
  });

  it('никогда не выходит за десятую долю', () => {
    expect(clampRatio(0.01, 10_000, 10)).toBe(0.1);
    expect(clampRatio(0.99, 10_000, 10)).toBe(0.9);
  });

  it('узкая область: обе стороны по половине', () => {
    expect(clampRatio(0.3, 300, 200)).toBe(0.5);
  });
});
