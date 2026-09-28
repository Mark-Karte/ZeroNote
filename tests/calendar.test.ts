import { describe, expect, it } from 'vitest';

import {
  dateKey,
  daysIn,
  monthGrid,
  monthKey,
  monthLabel,
  shiftMonth,
  touchesFolder,
  weekdayNames,
} from '../src/ui/calendar';
import { useLanguage } from '../src/l10n';
import en from '../l10n/en.json';
import ru from '../l10n/ru.json';

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

  it('месяц и дни недели — на языке окна (задача 154)', () => {
    expect(weekdayNames(0)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
    useLanguage('en', en);
    try {
      expect(monthLabel(2026, 9)).toBe('September 2026');
      expect(weekdayNames(6)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    } finally {
      useLanguage('ru', ru);
    }
  });

  it('неделя начинается с дня из региона Windows', () => {
    // 1 сентября 2026 года — вторник: с понедельника перед ним один день
    // августа, с воскресенья — два.
    expect(monthGrid(2026, 9)[0]![0]!.date).toBe('2026-08-31');
    const fromSunday = monthGrid(2026, 9, 6);
    expect(fromSunday[0]![0]!.date).toBe('2026-08-30');
    expect(fromSunday.every((week) => week.length === 7)).toBe(true);
    // Месяц, начавшийся в первый день недели, хвоста спереди не имеет:
    // 1 ноября 2026 года — воскресенье.
    expect(monthGrid(2026, 11, 6)[0]![0]!.date).toBe('2026-11-01');
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

/**
 * Календарь слушает наблюдатель за корнями (задача 107): перечитывает
 * месяц, только когда событие называет папку ежедневных заметок.
 */
describe('событие наблюдателя', () => {
  const folder = String.raw`C:\Users\user\Notes\Дневник`;

  it('узнаёт свою папку без оглядки на регистр и косую черту', () => {
    expect(touchesFolder([String.raw`C:\Users\user\Notes\Дневник`], folder)).toBe(true);
    expect(touchesFolder([String.raw`c:\users\USER\notes\дневник`], folder)).toBe(true);
    expect(touchesFolder(['C:/Users/user/Notes/Дневник/'], folder)).toBe(true);
  });

  it('не отзывается на соседние и вложенные папки', () => {
    expect(touchesFolder([String.raw`C:\Users\user\Notes`], folder)).toBe(false);
    expect(touchesFolder([String.raw`C:\Users\user\Notes\Дневник\архив`], folder)).toBe(false);
    expect(touchesFolder([String.raw`C:\Users\user\Notes\Дневник-2`], folder)).toBe(false);
    expect(touchesFolder([], folder)).toBe(false);
  });

  it('молчит, пока папка не известна', () => {
    expect(touchesFolder([String.raw`C:\Users\user\Notes\Дневник`], '')).toBe(false);
  });
});
