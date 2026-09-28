/**
 * «Сколько времени назад» для списка недавнего.
 *
 * Вынесено отдельно и проверяется тестом: в таких функциях ошибаются на
 * границах — минута против часа, «вчера» против «сегодня», — а увидеть это
 * глазами можно только дождавшись нужного времени суток.
 *
 * Точное время не показываем: в списке недавнего важен порядок и грубая
 * давность, а не минуты. Точное — в подсказке, там оно и уместно.
 */

import { formatDate, formatRelative, t } from '../../l10n';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Подпись давности. `now` передаётся явно — так функция проверяема,
 * а список не пересчитывается по-разному в двух местах одного кадра.
 *
 * Слова — у `Intl.RelativeTimeFormat` на языке окна (задача 154): он знает
 * и формы числа, и «вчера» любого языка, в том числе своего перевода.
 */
export function ago(whenMs: number, nowMs: number): string {
  const passed = nowMs - whenMs;

  // Время в будущем бывает: часы переводили, файл пришёл с другой машины.
  // Показывать «через два часа» в списке недавнего незачем.
  if (passed < MINUTE) return t('welcome.just-now');

  if (passed < HOUR) return formatRelative(-Math.floor(passed / MINUTE), 'minute');

  // Сутки считаем по календарю, а не по 24 часам: в семь утра «вчера»
  // означает вчера, даже если прошло десять часов.
  const days = calendarDaysBetween(whenMs, nowMs);

  if (days === 0) return formatRelative(-Math.floor(passed / HOUR), 'hour');
  // Словом — только «вчера»: `auto` у двух дней дал бы «позавчера»,
  // а список недавнего считает дни числом.
  if (days === 1) return formatRelative(-1, 'day', 'auto');
  if (days < 7) return formatRelative(-days, 'day');

  return dateOf(whenMs);
}

/** Сколько полуночей прошло между двумя мгновениями. */
function calendarDaysBetween(fromMs: number, toMs: number): number {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const midnightFrom = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const midnightTo = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((midnightTo.getTime() - midnightFrom.getTime()) / 86_400_000);
}

/**
 * Дата без года, если год тот же: год в списке недавнего почти всегда лишний.
 * Год — подстановкой, а не у `Intl`: тот пишет «7 ноября 2024 г.».
 */
function dateOf(whenMs: number): string {
  const when = new Date(whenMs);
  const date = formatDate(when, { day: 'numeric', month: 'long' });
  return when.getFullYear() === new Date().getFullYear()
    ? date
    : t('welcome.date-year', { date, year: when.getFullYear() });
}
