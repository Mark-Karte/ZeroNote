import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckOutcome, DownloadOutcome } from '../src/ipc/update';
import { askChoice, modal } from '../src/state/modal.svelte';
import {
  checkForUpdates,
  CHECK_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  updates,
} from '../src/state/updates.svelte';
import type { DownloadEvent } from '../src/ui/download';

/**
 * Обновление на глазах (задача 104).
 *
 * Настоящую загрузку проверить можно только выпуском, поэтому здесь команды
 * ядра подменены: события приходят от теста, а тест смотрит, что в это время
 * показывает диалог. Главное — три шага в верном порядке, отказ на каждом
 * называется своими словами, отмена снимает загрузку и ничего не ставит,
 * а ход работы не пропадает, если посреди загрузки всплыл другой вопрос.
 */

const ipc = vi.hoisted(() => ({
  checkUpdate: vi.fn(),
  downloadUpdate: vi.fn(),
  cancelUpdate: vi.fn(),
  installUpdate: vi.fn(),
}));
vi.mock('../src/ipc/update', () => ipc);

/** Неразрывный пробел: им длительности склеены с единицами. */
const NBSP = String.fromCharCode(0xa0);

const FOUND: CheckOutcome = { kind: 'found', version: '0.15.0', notes: 'Заметки к выпуску' };

/** Поддельная загрузка: ходом и концом управляет тест, отмена — как в ядре. */
function fakeDownload() {
  let onEvent: (event: DownloadEvent) => void = () => {};
  let settle: (outcome: DownloadOutcome) => void = () => {};
  let fail: (error: unknown) => void = () => {};

  ipc.downloadUpdate.mockImplementation(
    (_timeout: number, callback: (event: DownloadEvent) => void) => {
      onEvent = callback;
      return new Promise<DownloadOutcome>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      });
    },
  );
  // Ядро снимает задачу и отвечает на загрузку «отменено».
  ipc.cancelUpdate.mockImplementation(async () => settle('cancelled'));

  return {
    send: (event: DownloadEvent) => onEvent(event),
    finish: () => settle('ready'),
    fail: (error: unknown) => fail(error),
  };
}

/** Дождаться вопроса с этим заголовком и ответить. */
async function answer(title: string, id: string): Promise<void> {
  await vi.waitFor(() => expect(modal.request?.title).toBe(title));
  modal.request?.resolve(id);
}

/** Начать установку и дождаться начала загрузки. */
async function startInstall() {
  const fake = fakeDownload();
  ipc.checkUpdate.mockResolvedValue(FOUND);

  const done = checkForUpdates();
  await answer('Есть новая версия', 'install');
  await vi.waitFor(() => expect(ipc.downloadUpdate).toHaveBeenCalled());
  return { ...fake, done };
}

beforeEach(() => {
  for (const mock of Object.values(ipc)) mock.mockReset();
  // На Windows установка завершает процесс — обещание не разрешается никогда.
  ipc.installUpdate.mockReturnValue(new Promise<void>(() => {}));
  updates.busy = false;
  modal.request = null;
  modal.progress = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('обновление', () => {
  it('у проверки и у загрузки есть срок', async () => {
    const fake = await startInstall();

    expect(ipc.checkUpdate).toHaveBeenCalledWith(CHECK_TIMEOUT_MS);
    expect(ipc.downloadUpdate.mock.calls[0]?.[0]).toBe(DOWNLOAD_TIMEOUT_MS);
    fake.finish();
  });

  it('идёт тремя шагами: скачиваю, проверяю подпись, устанавливаю', async () => {
    const fake = await startInstall();

    expect(modal.progress?.title).toBe('Обновление до 0.15.0');
    expect(modal.progress?.steps).toEqual(['Скачиваю', 'Проверяю подпись', 'Устанавливаю']);
    expect(modal.progress?.step).toBe(0);
    expect(modal.progress?.detail).toBe('Соединяюсь с GitHub…');

    fake.send({ event: 'Started', data: { contentLength: 1000 } });
    fake.send({ event: 'Progress', data: { chunkLength: 250 } });
    expect(modal.progress?.fraction).toBe(0.25);
    expect(modal.progress?.detail).toMatch(/^250 Б из 1000 Б · 25%/);

    // `Finished` приходит до проверки подписи: плагин шлёт его
    // после последнего куска, а подпись сверяет потом.
    fake.send({ event: 'Progress', data: { chunkLength: 750 } });
    fake.send({ event: 'Finished' });
    expect(modal.progress?.step).toBe(1);
    expect(modal.progress?.fraction).toBe(1);
    expect(ipc.installUpdate).not.toHaveBeenCalled();

    fake.finish();
    await vi.waitFor(() => expect(ipc.installUpdate).toHaveBeenCalled());
    expect(modal.progress?.step).toBe(2);
    expect(modal.request).toBeNull();
  });

  /** Отменить можно, пока идёт загрузка; подпись и установку — нет. */
  it('кнопка отмены есть только во время загрузки', async () => {
    const fake = await startInstall();
    expect(modal.progress?.cancel).toBeTypeOf('function');

    fake.send({ event: 'Finished' });
    expect(modal.progress?.cancel).toBeNull();

    fake.finish();
    await vi.waitFor(() => expect(ipc.installUpdate).toHaveBeenCalled());
    expect(modal.progress?.cancel).toBeNull();
  });

  it('отмена снимает загрузку, закрывает окно и ничего не ставит', async () => {
    const fake = await startInstall();
    fake.send({ event: 'Started', data: { contentLength: 1000 } });
    fake.send({ event: 'Progress', data: { chunkLength: 100 } });

    modal.progress?.cancel?.();
    await fake.done;

    expect(ipc.cancelUpdate).toHaveBeenCalledOnce();
    expect(modal.progress).toBeNull();
    // Отменили сами — сообщать не о чем.
    expect(modal.request).toBeNull();
    expect(ipc.installUpdate).not.toHaveBeenCalled();
    expect(updates.busy).toBe(false);
  });

  /**
   * Отмена нажата в тот миг, когда загрузка уже кончилась: ядро ответило
   * «готово», но человек сказал «не надо» — ставить нельзя.
   */
  it('отмена сильнее «готово», пришедшего следом', async () => {
    const fake = await startInstall();
    ipc.cancelUpdate.mockResolvedValue(undefined);

    modal.progress?.cancel?.();
    expect(modal.progress?.detail).toBe('Отменяю загрузку…');
    fake.finish();
    await fake.done;

    expect(ipc.installUpdate).not.toHaveBeenCalled();
    expect(modal.progress).toBeNull();
  });

  it('отказ загрузки называется загрузкой, и ход работы закрывается', async () => {
    const fake = await startInstall();
    fake.send({ event: 'Started', data: { contentLength: 1000 } });
    fake.fail('operation timed out');

    await vi.waitFor(() => expect(modal.request?.title).toBe('Не удалось скачать обновление'));
    expect(modal.request?.text).toContain('Ничего не установлено.');
    expect(modal.request?.text).toContain('operation timed out');
    expect(modal.progress).toBeNull();
    expect(ipc.installUpdate).not.toHaveBeenCalled();
  });

  it('отказ после последнего куска — это подпись', async () => {
    const fake = await startInstall();
    fake.send({ event: 'Finished' });
    fake.fail('signature mismatch');

    await vi.waitFor(() =>
      expect(modal.request?.title).toBe('Обновление не прошло проверку подписи'),
    );
    expect(ipc.installUpdate).not.toHaveBeenCalled();
  });

  it('отказ запуска установщика называется им и советует страницу выпусков', async () => {
    const fake = await startInstall();
    ipc.installUpdate.mockRejectedValueOnce('access denied');
    fake.send({ event: 'Finished' });
    fake.finish();

    await vi.waitFor(() => expect(modal.request?.title).toBe('Не удалось запустить установщик'));
    expect(modal.request?.text).toContain('github.com/Mark-Karte/ZeroNote/releases');
  });

  /** Сообщение, опоздавшее к ответу ядра, шаг назад не отматывает. */
  it('опоздавший «Finished» не возвращает подпись после установки', async () => {
    const fake = await startInstall();
    fake.finish();
    await vi.waitFor(() => expect(ipc.installUpdate).toHaveBeenCalled());

    fake.send({ event: 'Finished' });
    expect(modal.progress?.step).toBe(2);
  });

  /**
   * Файл изменился на диске, пока идёт загрузка: вопрос встаёт поверх,
   * а ответ на него возвращает ход работы. Иначе загрузка шла бы дальше
   * невидимой и кончилась бы закрытием окна без предупреждения.
   */
  it('вопрос посреди загрузки не стирает ход работы', async () => {
    const fake = await startInstall();
    const progress = modal.progress;

    const asked = askChoice('Файл изменён', 'Перечитать?', [
      { id: 'ok', label: 'Да', primary: true },
    ]);
    expect(modal.request?.title).toBe('Файл изменён');
    expect(modal.progress).toBe(progress);

    modal.request?.resolve('ok');
    await asked;
    expect(modal.request).toBeNull();
    expect(modal.progress).toBe(progress);
    fake.finish();
  });

  it('«Не сейчас» ничего не скачивает', async () => {
    ipc.checkUpdate.mockResolvedValue(FOUND);

    const done = checkForUpdates();
    await answer('Есть новая версия', 'later');
    await done;

    expect(ipc.downloadUpdate).not.toHaveBeenCalled();
    expect(modal.progress).toBeNull();
    expect(updates.busy).toBe(false);
  });
});

describe('проверка', () => {
  /** На хорошей сети ответ приходит за доли секунды — мелькнувший диалог был бы шумом. */
  it('быстрый ответ не показывает ожидания', async () => {
    vi.useFakeTimers();
    ipc.checkUpdate.mockResolvedValue({ kind: 'upToDate' });

    void checkForUpdates();
    await vi.advanceTimersByTimeAsync(0);

    expect(modal.progress).toBeNull();
    expect(modal.request?.title).toBe('Обновлений нет');
  });

  it('затянувшаяся показывает ожидание со сроком и убирает его с ответом', async () => {
    vi.useFakeTimers();
    let respond: (value: CheckOutcome) => void = () => {};
    ipc.checkUpdate.mockReturnValue(new Promise((resolve) => (respond = resolve)));

    void checkForUpdates();
    await vi.advanceTimersByTimeAsync(399);
    expect(modal.progress).toBeNull();

    await vi.advanceTimersByTimeAsync(3_001);
    expect(modal.progress?.title).toBe('Проверяю обновления');
    expect(modal.progress?.detail.replaceAll(NBSP, ' ')).toBe('Жду ответа 3 с — не дольше 30 с.');

    respond({ kind: 'upToDate' });
    await vi.advanceTimersByTimeAsync(0);
    expect(modal.progress).toBeNull();
    expect(modal.request?.title).toBe('Обновлений нет');
  });

  it('отменённая проверка молчит', async () => {
    vi.useFakeTimers();
    let respond: (value: CheckOutcome) => void = () => {};
    ipc.checkUpdate.mockReturnValue(new Promise((resolve) => (respond = resolve)));
    ipc.cancelUpdate.mockImplementation(async () => respond({ kind: 'cancelled' }));

    const done = checkForUpdates();
    await vi.advanceTimersByTimeAsync(1_000);
    modal.progress?.cancel?.();
    await vi.advanceTimersByTimeAsync(0);
    await done;

    expect(ipc.cancelUpdate).toHaveBeenCalledOnce();
    expect(modal.progress).toBeNull();
    expect(modal.request).toBeNull();
  });

  it('отказ проверки называется проверкой', async () => {
    ipc.checkUpdate.mockRejectedValue('dns error');

    void checkForUpdates();
    await vi.waitFor(() => expect(modal.request?.title).toBe('Не удалось проверить обновления'));
    expect(modal.request?.text).toContain('dns error');
  });
});
