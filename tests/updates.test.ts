import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
 * Настоящую загрузку проверить можно только выпуском, поэтому здесь плагин
 * подменён: события приходят от теста, а тест смотрит, что в это время
 * показывает диалог. Главное — три шага в верном порядке, отказ на каждом
 * называется своими словами, и ход работы не пропадает, если посреди
 * загрузки всплыл другой вопрос.
 */

const { check } = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check }));

/** Поддельное обновление: загрузкой управляет тест. */
function fakeUpdate() {
  let onEvent: (event: DownloadEvent) => void = () => {};
  let finish: () => void = () => {};
  let fail: (error: unknown) => void = () => {};

  const update = {
    version: '0.15.0',
    body: 'Заметки к выпуску',
    download: vi.fn((callback: (event: DownloadEvent) => void, _options?: { timeout?: number }) => {
      onEvent = callback;
      return new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    }),
    // На Windows установка завершает процесс — обещание не разрешается никогда.
    install: vi.fn(() => new Promise<void>(() => {})),
  };

  return {
    update,
    send: (event: DownloadEvent) => onEvent(event),
    finish: () => finish(),
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
  const fake = fakeUpdate();
  check.mockResolvedValue(fake.update);

  void checkForUpdates();
  await answer('Есть новая версия', 'install');
  await vi.waitFor(() => expect(fake.update.download).toHaveBeenCalled());
  return fake;
}

beforeEach(() => {
  check.mockReset();
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

    expect(check).toHaveBeenCalledWith({ timeout: CHECK_TIMEOUT_MS });
    expect(fake.update.download.mock.calls[0]?.[1]).toEqual({ timeout: DOWNLOAD_TIMEOUT_MS });
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
    expect(fake.update.install).not.toHaveBeenCalled();

    fake.finish();
    await vi.waitFor(() => expect(fake.update.install).toHaveBeenCalled());
    expect(modal.progress?.step).toBe(2);
    // Кнопок нет: прервать установку нечем, и обещать это нельзя.
    expect(modal.request).toBeNull();
  });

  it('отказ загрузки называется загрузкой, и ход работы закрывается', async () => {
    const fake = await startInstall();
    fake.send({ event: 'Started', data: { contentLength: 1000 } });
    fake.fail(new Error('operation timed out'));

    await vi.waitFor(() => expect(modal.request?.title).toBe('Не удалось скачать обновление'));
    expect(modal.request?.text).toContain('Ничего не установлено.');
    expect(modal.request?.text).toContain('operation timed out');
    expect(modal.progress).toBeNull();
    expect(fake.update.install).not.toHaveBeenCalled();
  });

  it('отказ после последнего куска — это подпись', async () => {
    const fake = await startInstall();
    fake.send({ event: 'Finished' });
    fake.fail(new Error('signature mismatch'));

    await vi.waitFor(() =>
      expect(modal.request?.title).toBe('Обновление не прошло проверку подписи'),
    );
    expect(fake.update.install).not.toHaveBeenCalled();
  });

  it('отказ запуска установщика называется им и советует страницу выпусков', async () => {
    const fake = await startInstall();
    fake.update.install.mockRejectedValueOnce(new Error('access denied'));
    fake.send({ event: 'Finished' });
    fake.finish();

    await vi.waitFor(() => expect(modal.request?.title).toBe('Не удалось запустить установщик'));
    expect(modal.request?.text).toContain('github.com/Mark-Karte/ZeroNote/releases');
  });

  /**
   * Файл изменился на диске, пока идёт загрузка: вопрос встаёт поверх,
   * а ответ на него возвращает ход работы. Иначе загрузка шла бы дальше
   * невидимой и кончилась бы закрытием окна без предупреждения.
   */
  it('вопрос посреди загрузки не стирает ход работы', async () => {
    const fake = await startInstall();
    const progress = modal.progress;

    const asked = askChoice('Файл изменён', 'Перечитать?', [{ id: 'ok', label: 'Да', primary: true }]);
    expect(modal.request?.title).toBe('Файл изменён');
    expect(modal.progress).toBe(progress);

    modal.request?.resolve('ok');
    await asked;
    expect(modal.request).toBeNull();
    expect(modal.progress).toBe(progress);
    fake.finish();
  });

  it('«Не сейчас» ничего не скачивает', async () => {
    const fake = fakeUpdate();
    check.mockResolvedValue(fake.update);

    const done = checkForUpdates();
    await answer('Есть новая версия', 'later');
    await done;

    expect(fake.update.download).not.toHaveBeenCalled();
    expect(modal.progress).toBeNull();
    expect(updates.busy).toBe(false);
  });
});

describe('проверка', () => {
  /** На хорошей сети ответ приходит за доли секунды — мелькнувший диалог был бы шумом. */
  it('быстрый ответ не показывает ожидания', async () => {
    vi.useFakeTimers();
    check.mockResolvedValue(null);

    void checkForUpdates();
    await vi.advanceTimersByTimeAsync(0);

    expect(modal.progress).toBeNull();
    expect(modal.request?.title).toBe('Обновлений нет');
  });

  it('затянувшаяся показывает ожидание со сроком и убирает его с ответом', async () => {
    vi.useFakeTimers();
    let respond: (value: null) => void = () => {};
    check.mockReturnValue(new Promise((resolve) => (respond = resolve)));

    void checkForUpdates();
    await vi.advanceTimersByTimeAsync(399);
    expect(modal.progress).toBeNull();

    await vi.advanceTimersByTimeAsync(3_001);
    expect(modal.progress?.title).toBe('Проверяю обновления');
    expect(modal.progress?.detail.replaceAll('\u00a0', ' ')).toBe(
      'Жду ответа 3 с — не дольше 30 с.',
    );

    respond(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(modal.progress).toBeNull();
    expect(modal.request?.title).toBe('Обновлений нет');
  });

  it('отказ проверки называется проверкой', async () => {
    check.mockRejectedValue(new Error('dns error'));

    void checkForUpdates();
    await vi.waitFor(() => expect(modal.request?.title).toBe('Не удалось проверить обновления'));
    expect(modal.request?.text).toContain('dns error');
  });
});
