import { windowLanguage } from '../ipc/l10n';
import { useLanguage, useWeekStart, type Table } from './index';

/**
 * Таблицы встроенных языков — каждая своим куском сборки: окно грузит
 * только нужные. Новый встроенный язык — новый файл в `l10n/`, этот
 * список подхватит его сам.
 */
const TABLES = import.meta.glob<Table>('../../l10n/*.json', { import: 'default' });

function builtinTable(code: string): Promise<Table> | null {
  const load = TABLES[`../../l10n/${code}.json`];
  return load ? load() : null;
}

/**
 * Узнать у ядра язык окна и поставить его таблицы — до первой отрисовки.
 *
 * Язык выбирает ядро: ему он нужен раньше окна — жалобы на конфиги
 * и ошибки пишет оно, — и выбор должен быть один на обоих.
 *
 * Таблиц бывает до трёх (задача 153): свой перевод из папки данных,
 * встроенная таблица того же языка и английская — чего нет в первой,
 * берётся у следующей. Английская не грузится, когда язык встроенный:
 * встроенные полны, это сверяет тест.
 */
export async function startLanguage(): Promise<void> {
  const language = await windowLanguage();
  const tables: Table[] = [];
  if (language.table) tables.push(language.table);

  const builtin = language.builtin ? builtinTable(language.builtin) : null;
  if (builtin) tables.push(await builtin);
  else {
    const english = builtinTable('en');
    if (!english) throw new Error('l10n: в сборке нет английской таблицы');
    tables.push(await english);
  }

  useLanguage(language.code, tables);
  useWeekStart(language.weekStart);
  // Язык страницы — для переносов, озвучки и шрифтов системы.
  document.documentElement.lang = language.code;
}
