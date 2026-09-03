import { describe, expect, it } from 'vitest';
import { ago } from '../src/ui/welcome/ago';

/** Опорная точка: 15 марта 2026 года, 14:30. */
const NOW = new Date(2026, 2, 15, 14, 30).getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('давность', () => {
  it('меньше минуты — «только что»', () => {
    expect(ago(NOW, NOW)).toBe('только что');
    expect(ago(NOW - 59_000, NOW)).toBe('только что');
  });

  it('минуты склоняются', () => {
    expect(ago(NOW - MINUTE, NOW)).toBe('1 минуту назад');
    expect(ago(NOW - 3 * MINUTE, NOW)).toBe('3 минуты назад');
    expect(ago(NOW - 5 * MINUTE, NOW)).toBe('5 минут назад');
    expect(ago(NOW - 21 * MINUTE, NOW)).toBe('21 минуту назад');
    // Одиннадцать — не «одиннадцать минуту»: одиннадцатые в русском особые.
    expect(ago(NOW - 11 * MINUTE, NOW)).toBe('11 минут назад');
  });

  it('часы склоняются', () => {
    expect(ago(NOW - HOUR, NOW)).toBe('1 час назад');
    expect(ago(NOW - 2 * HOUR, NOW)).toBe('2 часа назад');
    expect(ago(NOW - 6 * HOUR, NOW)).toBe('6 часов назад');
  });

  it('вчера — это вчера, даже если прошло меньше суток', () => {
    // 23:00 предыдущего дня: прошло 15,5 часов, но полночь была.
    const lateYesterday = new Date(2026, 2, 14, 23, 0).getTime();
    expect(ago(lateYesterday, NOW)).toBe('вчера');
  });

  it('сегодня — это сегодня, даже если прошло много часов', () => {
    const earlyToday = new Date(2026, 2, 15, 1, 0).getTime();
    expect(ago(earlyToday, NOW)).toBe('13 часов назад');
  });

  it('от двух до шести дней — днями', () => {
    const threeDaysAgo = new Date(2026, 2, 12, 10, 0).getTime();
    expect(ago(threeDaysAgo, NOW)).toBe('3 дня назад');
  });

  it('неделя и больше — датой', () => {
    const longAgo = new Date(2026, 1, 3, 10, 0).getTime();
    expect(ago(longAgo, NOW)).toBe('3 февраля');
  });

  it('другой год показывается вместе с годом', () => {
    const lastYear = new Date(2024, 10, 7, 10, 0).getTime();
    expect(ago(lastYear, NOW)).toBe('7 ноября 2024');
  });

  it('время из будущего не ломает подпись', () => {
    // Часы переводили, файл пришёл с другой машины — бывает.
    expect(ago(NOW + HOUR, NOW)).toBe('только что');
  });
});
