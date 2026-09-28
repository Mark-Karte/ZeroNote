/**
 * Вес файла по-человечески.
 *
 * Двоичные приставки, как во всех приёмках проекта: МиБ — это 1024 КиБ.
 * Разнобой между «мегабайтом» установщика и «мегабайтом» строки состояния
 * заметен ровно тогда, когда числа сравнивают, — а сравнивают их именно
 * в тот момент, когда что-то пошло не так.
 */

import { formatNumber, t } from '../l10n';

/** Сколько ступеней у единиц: байты, КиБ, МиБ, ГиБ, ТиБ. */
const UNIT_COUNT = 5;

/**
 * Имя единицы на языке окна. Выбором, а не списком ключей: ключ строки
 * пишется в коде только буквально, иначе тест не сверит его с таблицей.
 */
function unitName(unit: number): string {
  switch (unit) {
    case 0:
      return t('size.b');
    case 1:
      return t('size.kib');
    case 2:
      return t('size.mib');
    case 3:
      return t('size.gib');
    default:
      return t('size.tib');
  }
}

/**
 * Знаков после запятой ровно столько, сколько добавляет смысл: «482 КиБ»
 * читается с одного взгляда, «482,3 КиБ» — нет. Дробная часть остаётся
 * только у малых чисел, где она и есть весь ответ: «1,4 МиБ» против «1 МиБ».
 */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} ${unitName(0)}`;

  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < UNIT_COUNT - 1) {
    value /= 1024;
    unit += 1;
  }

  // До десяти — с десятой долей, дальше округляем: разница между 482 и 482,3
  // килобайтами не значит ничего, а между 1,4 и 1 мегабайтом — значит.
  // Запятая или точка — по языку окна.
  const text =
    value < 10
      ? formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : String(Math.round(value));
  return `${text} ${unitName(unit)}`;
}
