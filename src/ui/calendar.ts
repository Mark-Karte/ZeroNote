/**
 * Раскладка месяца для календаря заметок (задача 97).
 *
 * Чистые функции: календарь — это арифметика, и проверять её на живом окне
 * значило бы проверять её один раз в месяц. Всё, что здесь есть, закрыто
 * тестами; компонент рисует то, что эти функции посчитали.
 *
 * Неделя начинается с того дня, который назначен в региональных настройках
 * Windows (задача 154), — у русского региона с понедельника. Названия
 * месяцев и дней — у `Intl`, на языке окна.
 */

import { capitalize, formatDate } from '../l10n';

/** Ячейка сетки: число месяца и принадлежит ли оно показанному месяцу. */
export interface Cell {
  /** Число месяца — 1…31. */
  day: number;
  /** Дата целиком, `ГГГГ-ММ-ДД`: по ней открывают заметку. */
  date: string;
  /** Ячейка принадлежит показанному месяцу, а не хвосту соседнего. */
  inMonth: boolean;
}

/** Двузначное число со старшим нулём. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Ключ месяца — `ГГГГ-ММ`. Им ядро отбирает записанные дни. */
export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

/** Ключ дня — `ГГГГ-ММ-ДД`. Тот же вид, в каком дату ждёт ядро. */
export function dateKey(year: number, month: number, day: number): string {
  return `${monthKey(year, month)}-${pad(day)}`;
}

/**
 * Подпись месяца — «Сентябрь 2026», «September 2026». Название — у `Intl`
 * на языке окна: месяц без числа он называет так, как пишут в заголовке
 * (у русского — именительный падеж, а не «сентября»).
 */
export function monthLabel(year: number, month: number): string {
  const name = formatDate(new Date(Date.UTC(year, month - 1, 1)), { month: 'long', timeZone: 'UTC' });
  return `${capitalize(name)} ${year}`;
}

/**
 * Короткие имена дней недели по порядку столбцов: «Пн … Вс» или,
 * с воскресенья, «Sun … Sat». `first` — первый день: 0 — понедельник.
 */
export function weekdayNames(first: number): string[] {
  // 1 января 2024 года — понедельник: от него отсчитываются остальные.
  return Array.from({ length: 7 }, (_, i) =>
    capitalize(
      formatDate(new Date(Date.UTC(2024, 0, 1 + ((first + i) % 7))), {
        weekday: 'short',
        timeZone: 'UTC',
      }),
    ),
  );
}

/** Сколько дней в месяце. Февраль считается по правилам високосного года. */
export function daysIn(year: number, month: number): number {
  // Нулевой день следующего месяца — это последний день этого.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Соседний месяц — вперёд или назад.
 *
 * Отдельной функцией, потому что переход через год — самое обычное место
 * для ошибки на единицу, и его стоит проверить тестом, а не глазами
 * в декабре.
 */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/**
 * Сетка месяца: недели по семь ячеек, с хвостами соседних месяцев.
 *
 * Хвосты нужны, чтобы недели были целыми: сетка с дырами по краям читается
 * как ошибка отрисовки. Принадлежность месяцу видна по `inMonth` — рисуются
 * такие дни тише.
 *
 * `weekStart` — первый день недели: 0 — понедельник, 6 — воскресенье.
 */
export function monthGrid(year: number, month: number, weekStart = 0): Cell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // `getUTCDay` считает от воскресенья: сначала — к счёту от понедельника,
  // потом — от первого дня недели.
  const lead = ((first.getUTCDay() + 6) % 7 - weekStart + 7) % 7;

  const total = daysIn(year, month);
  const weeks: Cell[][] = [];
  let week: Cell[] = [];

  const push = (offsetDays: number, inMonth: boolean): void => {
    const at = new Date(Date.UTC(year, month - 1, 1 + offsetDays));
    week.push({
      day: at.getUTCDate(),
      date: dateKey(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate()),
      inMonth,
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  };

  for (let i = lead; i > 0; i -= 1) push(-i, false);
  for (let day = 0; day < total; day += 1) push(day, true);
  // Хвост последней недели — дни следующего месяца.
  for (let i = 0; week.length > 0; i += 1) push(total + i, false);

  return weeks;
}

/** Путь для сравнения: Windows не различает регистр и косую черту. */
function folderKey(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * Касается ли событие наблюдателя папки ежедневных заметок (задача 107).
 *
 * Наблюдатель за корнями называет папки, в которых что-то изменилось; если
 * среди них папка ежедневных, календарь перечитывает месяц. Так он видит
 * и заметку, созданную другой программой, — до задачи 107 она появлялась
 * только при смене месяца.
 */
export function touchesFolder(changed: readonly string[], folder: string): boolean {
  if (folder === '') return false;
  const key = folderKey(folder);
  return changed.some((dir) => folderKey(dir) === key);
}
