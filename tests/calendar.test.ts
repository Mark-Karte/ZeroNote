import { describe, expect, it } from 'vitest';

import {
  dateKey,
  daysIn,
  monthGrid,
  monthKey,
  monthLabel,
  shiftMonth,
} from '../src/ui/calendar';

/**
 * Календарь заметок (задача 97).
 *
 * Проверяется арифметика, а не вид: ошибка на единицу в начале недели или
 * при переходе через год ловится тестом сразу, а глазами — один раз в месяц
 * и только если посмотреть именно в тот месяц.
 */
describe('раскладка месяца', () => {
  it('ключи месяца и дня пишутся с ведущим нулём', () => {
    expect(monthKey(2026, 9)).toBe('2026-09');
    expect(dateKey(2026, 9, 1)).toBe('2026-09-01');
    expect(dateKey(2026, 12, 31)).toBe('2026-12-31');
  });

  it('подписывает месяц по-русски', () => {
    expect(monthLabel(2026, 9)).toBe('Сентябрь 2026');
    expect(monthLabel(2027, 1)).toBe('Январь 2027');
  });

  it('считает февраль по правилам високосного года', () => {
    expect(daysIn(2026, 2)).toBe(28);
    expect(daysIn(2028, 2)).toBe(29);
    expect(daysIn(2100, 2)).toBe(28);
    expect(daysIn(2000, 2)).toBe(29);
    expect(daysIn(2026, 9)).toBe(30);
  });

  it('переходит через год в обе стороны', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 9, 3)).toEqual({ year: 2026, month: 12 });
    expect(shiftMonth(2026, 9, -13)).toEqual({ year: 2025, month: 8 });
  });

  describe('сетка', () => {
    const grid = monthGrid(2026, 9);

    it('состоит из целых недель', () => {
      for (const week of grid) expect(week).toHaveLength(7);
    });

    /** 1 сентября 2026 — вторник, значит первый столбец занят 31 августа. */
    it('начинает неделю с понедельника и достраивает хвосты', () => {
      expect(grid[0]?.[0]).toEqual({ day: 31, date: '2026-08-31', inMonth: false });
      expect(grid[0]?.[1]).toEqual({ day: 1, date: '2026-09-01', inMonth: true });

      const last = grid[grid.length - 1]!;
      expect(last[last.length - 1]?.inMonth).toBe(false);
    });

    it('содержит все дни месяца по одному разу', () => {
      const own = grid.flat().filter((cell) => cell.inMonth);
      expect(own).toHaveLength(30);
      expect(own[0]?.date).toBe('2026-09-01');
      expect(own[29]?.date).toBe('2026-09-30');
      expect(new Set(own.map((cell) => cell.date)).size).toBe(30);
    });

    /** Месяц, начинающийся с понедельника, обходится без левого хвоста. */
    it('не выдумывает хвост, когда его нет', () => {
      const june = monthGrid(2026, 6);
      expect(june[0]?.[0]).toEqual({ day: 1, date: '2026-06-01', inMonth: true });
    });
  });
});
