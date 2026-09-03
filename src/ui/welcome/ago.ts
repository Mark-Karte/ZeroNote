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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Слово «минута», «час» или «день» в нужной форме. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = count % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Подпись давности. `now` передаётся явно — так функция проверяема,
 * а список не пересчитывается по-разному в двух местах одного кадра.
 */
export function ago(whenMs: number, nowMs: number): string {
  const passed = nowMs - whenMs;

  // Время в будущем бывает: часы переводили, файл пришёл с другой машины.
  // Показывать «через два часа» в списке недавнего незачем.
  if (passed < MINUTE) return 'только что';

  if (passed < HOUR) {
    const minutes = Math.floor(passed / MINUTE);
    return `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} назад`;
  }

  // Сутки считаем по календарю, а не по 24 часам: в семь утра «вчера»
  // означает вчера, даже если прошло десять часов.
  const days = calendarDaysBetween(whenMs, nowMs);

  if (days === 0) {
    const hours = Math.floor(passed / HOUR);
    return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  }
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;

  return formatDate(whenMs);
}

/** Сколько полуночей прошло между двумя мгновениями. */
function calendarDaysBetween(fromMs: number, toMs: number): number {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const midnightFrom = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const midnightTo = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((midnightTo.getTime() - midnightFrom.getTime()) / 86_400_000);
}

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** Дата без года, если год тот же: год в списке недавнего почти всегда лишний. */
function formatDate(whenMs: number): string {
  const when = new Date(whenMs);
  const day = when.getDate();
  const month = MONTHS[when.getMonth()]!;
  const now = new Date();
  return when.getFullYear() === now.getFullYear()
    ? `${day} ${month}`
    : `${day} ${month} ${when.getFullYear()}`;
}
