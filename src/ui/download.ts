import { fileSize } from './size';
import { formatNumber, t } from '../l10n';

/**
 * Ход загрузки обновления словами (задача 104).
 *
 * Жалоба владельца: при плохой сети не понятно, обновляется приложение или
 * подвисло. Отвечают на неё три вещи, и все три считаются здесь чистыми
 * функциями: сколько пришло (полоска и байты), с какой скоростью, и — главное
 * для вопроса «подвисло?» — сколько секунд данные не приходят вовсе.
 *
 * Время передаётся снаружи, а не берётся из `Date.now()`: так тест
 * проверяет «тишину двенадцать секунд», не прожидая их.
 */

/**
 * Через сколько тишины сказать о ней вслух. На живой сети куски идут
 * непрерывно, на плохой бывают паузы в секунду-две; пять — уже не пауза.
 */
export const STALL_AFTER_MS = 5_000;

/** Что известно о загрузке к этой минуте. */
export interface Download {
  /** Когда нажали «Установить». */
  startedAt: number;
  /** Длина из заголовка ответа; `null` — сервер её не назвал (или ещё не ответил). */
  total: number | null;
  /** Сколько пришло байт. */
  received: number;
  /** Когда пришёл последний кусок; `null` — ни одного ещё не было. */
  lastChunkAt: number | null;
}

/** События плагина обновлений — повторены здесь, чтобы модуль не тянул плагин. */
export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

export function startDownload(now: number): Download {
  return { startedAt: now, total: null, received: 0, lastChunkAt: null };
}

/**
 * Учесть событие плагина.
 *
 * `Started` приходит вместе с первым куском, а не при соединении: плагин
 * шлёт его из обработчика куска. Поэтому до первого куска длины нет,
 * и «соединяюсь» — честное описание этого времени.
 */
export function onDownloadEvent(download: Download, event: DownloadEvent, now: number): Download {
  switch (event.event) {
    case 'Started':
      // Нулевая длина — это не «пустой файл», а сервер без заголовка.
      return { ...download, total: event.data.contentLength || null };
    case 'Progress':
      return {
        ...download,
        received: download.received + event.data.chunkLength,
        lastChunkAt: now,
      };
    case 'Finished':
      return download;
  }
}

export interface DownloadView {
  /**
   * Доля от 0 до 1 или `null`, если длина неизвестна. Без длины полоски
   * нет: полоска, бегущая к выдуманному концу, врёт ровно о том, о чём
   * человек спрашивает.
   */
  fraction: number | null;
  /** «2,4 МиБ из 5,5 МиБ · 44% · 120 КиБ/с». */
  amount: string;
  /** Тишина в сети словами; пустая строка — данные идут. */
  stall: string;
}

/**
 * Что показать сейчас.
 *
 * `limitMs` — срок, после которого загрузка сдастся сама. Он нужен тишине:
 * «данные не приходят» без срока читается как «ждать вечно», а отменить
 * загрузку нельзя — у плагина нет способа её прервать.
 */
export function downloadView(download: Download, now: number, limitMs: number): DownloadView {
  const { total, received, lastChunkAt, startedAt } = download;

  let fraction: number | null = null;
  let amount: string;

  if (lastChunkAt === null) {
    amount = t('download.connecting');
  } else if (total !== null) {
    fraction = Math.min(1, received / total);
    // Вниз, а не к ближайшему: 99,6% — это ещё не «100%».
    const percent = Math.floor(fraction * 100);
    amount = t('download.progress', {
      received: fileSize(received),
      total: fileSize(total),
      percent: formatNumber(percent),
    });
  } else {
    amount = t('download.received', { size: fileSize(received) });
  }

  // Средняя скорость с нажатия: мгновенная скачет от куска к куску,
  // а вопрос «долго ли ещё» задают про среднюю.
  const seconds = (now - startedAt) / 1000;
  if (received > 0 && seconds >= 1) {
    amount += ` · ${t('download.speed', { size: fileSize(received / seconds) })}`;
  }

  const quietSince = lastChunkAt ?? startedAt;
  const quiet = now - quietSince;
  let stall = '';
  if (quiet >= STALL_AFTER_MS) {
    const what = lastChunkAt === null ? t('download.silent.github') : t('download.silent.data');
    const left = Math.max(0, limitMs - (now - startedAt));
    stall = t('download.stall', { what, quiet: duration(quiet), left: duration(left) });
  }

  return { fraction, amount, stall };
}

/** Итог загрузки: «Скачано 5,5 МиБ за 42 с». */
export function finishedText(download: Download, now: number): string {
  return t('download.finished', {
    size: fileSize(download.received),
    time: duration(now - download.startedAt),
  });
}

/** Ожидание ответа на проверку: «Жду ответа 3 с — не дольше 30 с». */
export function waitingText(elapsedMs: number, limitMs: number): string {
  return t('download.waiting', { elapsed: duration(elapsedMs), limit: duration(limitMs) });
}

/**
 * Неразрывный пробел: число не отрывается от своей единицы переносом строки.
 * Найдено на живом окне — предупреждение о тишине кончалось строкой «с.».
 */
const NB = '\u00a0';

/**
 * Длительность словами: «12 с», «2 мин 5 с», «15 мин».
 *
 * Вниз до секунды: «0 с» на первом тике честнее, чем «1 с», которой ещё
 * не прошло. Внутри длительности пробелы неразрывные: «14 мин» на одной
 * строке и «42 с» на другой читаются как два разных срока.
 */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return unit(total, 'second');

  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0
    ? unit(minutes, 'minute')
    : `${unit(minutes, 'minute')}${NB}${unit(seconds, 'second')}`;
}

/**
 * Число с единицей времени на языке окна — «12 с», «12 sec»: единицы знает
 * `Intl`. Пробел в его ответе обычный — меняется на неразрывный.
 */
function unit(value: number, name: 'second' | 'minute'): string {
  return formatNumber(value, { style: 'unit', unit: name, unitDisplay: 'short' }).replace(/ /g, NB);
}
