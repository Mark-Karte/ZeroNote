import { describe, expect, it } from 'vitest';

import {
  downloadView,
  duration,
  finishedText,
  onDownloadEvent,
  startDownload,
  STALL_AFTER_MS,
  waitingText,
  type Download,
  type DownloadEvent,
} from '../src/ui/download';

/**
 * Ход загрузки обновления словами (задача 104).
 *
 * Вопрос, на который отвечает экран, — «обновляется или подвисло?». Поэтому
 * главное здесь не проценты, а тишина: сколько секунд данные не приходят
 * и когда загрузка сдастся сама.
 */

const MIB = 1024 * 1024;
const LIMIT = 15 * 60_000;

/** Неразрывные пробелы — как обычные: их проверяет отдельный тест. */
const plain = (text: string): string => text.replaceAll('\u00a0', ' ');

/** Прогнать события с отметками времени, начав загрузку в нуле. */
function run(events: [number, DownloadEvent][]): Download {
  return events.reduce(
    (download, [at, event]) => onDownloadEvent(download, event, at),
    startDownload(0),
  );
}

describe('загрузка обновления', () => {
  it('до первого куска — соединение, без полоски и без скорости', () => {
    const view = downloadView(startDownload(0), 2_000, LIMIT);

    expect(view.fraction).toBeNull();
    expect(view.amount).toBe('Соединяюсь с GitHub…');
    expect(view.stall).toBe('');
  });

  it('с длиной — полоска, байты, проценты и средняя скорость', () => {
    const download = run([
      [1_000, { event: 'Started', data: { contentLength: 4 * MIB } }],
      [1_000, { event: 'Progress', data: { chunkLength: MIB } }],
    ]);
    const view = downloadView(download, 2_000, LIMIT);

    expect(view.fraction).toBe(0.25);
    expect(view.amount).toBe('1,0 МиБ из 4,0 МиБ · 25% · 512 КиБ/с');
    expect(view.stall).toBe('');
  });

  /** Полоска, бегущая к выдуманному концу, врала бы ровно о том, о чём спрашивают. */
  it('без длины — только скачанное, полоски нет', () => {
    const download = run([
      [500, { event: 'Started', data: {} }],
      [500, { event: 'Progress', data: { chunkLength: 3 * MIB } }],
    ]);
    const view = downloadView(download, 1_000, LIMIT);

    expect(view.fraction).toBeNull();
    expect(view.amount).toBe('Скачано 3,0 МиБ · 3,0 МиБ/с');
  });

  it('нулевая длина — это сервер без заголовка, а не пустой файл', () => {
    const download = run([
      [0, { event: 'Started', data: { contentLength: 0 } }],
      [0, { event: 'Progress', data: { chunkLength: 10 } }],
    ]);
    expect(downloadView(download, 0, LIMIT).fraction).toBeNull();
  });

  it('проценты округляются вниз: почти всё — ещё не сто', () => {
    const download = run([
      [0, { event: 'Started', data: { contentLength: 1000 } }],
      [0, { event: 'Progress', data: { chunkLength: 996 } }],
    ]);
    expect(downloadView(download, 0, LIMIT).amount).toContain('· 99%');
  });

  it('куски складываются', () => {
    const download = run([
      [0, { event: 'Started', data: { contentLength: 300 } }],
      [10, { event: 'Progress', data: { chunkLength: 100 } }],
      [20, { event: 'Progress', data: { chunkLength: 100 } }],
      [30, { event: 'Progress', data: { chunkLength: 100 } }],
      [30, { event: 'Finished' }],
    ]);

    expect(download.received).toBe(300);
    expect(downloadView(download, 30, LIMIT).fraction).toBe(1);
  });
});

describe('тишина в сети', () => {
  const started = run([
    [0, { event: 'Started', data: { contentLength: 10 * MIB } }],
    [1_000, { event: 'Progress', data: { chunkLength: MIB } }],
  ]);

  it('короткая пауза — не повод для слов', () => {
    expect(downloadView(started, 1_000 + STALL_AFTER_MS - 1, LIMIT).stall).toBe('');
  });

  /** Без срока «данные не приходят» читается как «ждать вечно». */
  it('долгая — называется вместе со сроком, когда загрузка сдастся', () => {
    const view = downloadView(started, 13_000, LIMIT);
    expect(plain(view.stall)).toBe(
      'Данные не приходят 12 с. Если сеть не вернётся, загрузка прервётся через 14 мин 47 с.',
    );
  });

  it('считается с последнего куска, а не с начала', () => {
    const resumed = onDownloadEvent(started, { event: 'Progress', data: { chunkLength: 1 } }, 60_000);
    expect(downloadView(resumed, 61_000, LIMIT).stall).toBe('');
  });

  it('до первого куска — это молчание GitHub, а не сети вообще', () => {
    expect(plain(downloadView(startDownload(0), 7_000, LIMIT).stall)).toMatch(
      /^GitHub не отвечает 7 с\./,
    );
  });

  it('за сроком — ноль, а не минус', () => {
    expect(plain(downloadView(started, LIMIT + 5_000, LIMIT).stall)).toMatch(
      /прервётся через 0 с\.$/,
    );
  });
});

describe('слова о времени', () => {
  it('секунды, минуты, минуты с секундами', () => {
    expect(plain(duration(0))).toBe('0 с');
    expect(plain(duration(999))).toBe('0 с');
    expect(plain(duration(59_999))).toBe('59 с');
    expect(plain(duration(60_000))).toBe('1 мин');
    expect(plain(duration(125_000))).toBe('2 мин 5 с');
    expect(plain(duration(-5))).toBe('0 с');
  });

  /** Найдено на живом окне: предупреждение кончалось строкой из одного «с.». */
  it('длительность не рвётся переносом строки', () => {
    expect(duration(887_000)).not.toContain(' ');
  });

  it('ожидание проверки называет срок', () => {
    expect(plain(waitingText(3_400, 30_000))).toBe('Жду ответа 3 с — не дольше 30 с.');
  });

  it('итог загрузки — сколько и за сколько', () => {
    const download = run([[0, { event: 'Progress', data: { chunkLength: 5 * MIB } }]]);
    expect(plain(finishedText(download, 42_000))).toBe('Скачано 5,0 МиБ за 42 с.');
  });
});
