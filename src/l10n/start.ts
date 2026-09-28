import { languageCode } from '../ipc/l10n';
import { useLanguage, type Table } from './index';

/**
 * Таблицы всех языков — каждая своим куском сборки: окно грузит только
 * таблицу своего языка. Новый язык — новый файл в `l10n/`, этот список
 * подхватит его сам.
 */
const TABLES = import.meta.glob<Table>('../../l10n/*.json', { import: 'default' });

function loaderOf(code: string): (() => Promise<Table>) | undefined {
  return TABLES[`../../l10n/${code}.json`];
}

/**
 * Узнать у ядра язык окна и поставить его таблицу — до первой отрисовки.
 *
 * Язык выбирает ядро: ему он нужен раньше окна — жалобы на конфиги
 * и ошибки пишет оно, — и выбор должен быть один на обоих.
 */
export async function startLanguage(): Promise<void> {
  const code = await languageCode();
  const load = loaderOf(code) ?? loaderOf('ru');
  if (!load) throw new Error('l10n: нет таблицы русского языка');
  useLanguage(loaderOf(code) ? code : 'ru', await load());
}
