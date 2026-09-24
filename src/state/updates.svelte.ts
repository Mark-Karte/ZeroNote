import { check, type Update } from '@tauri-apps/plugin-updater';

import { askChoice, showProgress } from '../state/modal.svelte';
import {
  downloadView,
  finishedText,
  onDownloadEvent,
  startDownload,
  waitingText,
  type DownloadEvent,
} from '../ui/download';
import { version } from '../version';

/**
 * Обновление из GitHub.
 *
 * Единственное место во всём приложении, где открывается сетевое соединение,
 * и открывается оно только по нажатию (Р-118). Ни фоновой проверки, ни
 * расписания: приложение, которое ходит в сеть само, обязано об этом
 * спрашивать, а мы обошлись без вопроса, обойдясь без хождения.
 *
 * Запрос делает ядро, а не вебвью: плагин обновлений работает на стороне
 * Rust. Поэтому политика безопасности окна остаётся прежней — вебвью
 * по-прежнему не открывает ни одного соединения.
 *
 * Между «нашлась новая версия» и «ставим» стоит человек: сначала вопрос
 * с номером версии и описанием, и только по второму нажатию — загрузка.
 *
 * Всё, что занимает время, идёт на глазах (задача 104): при плохой сети
 * иначе не отличить «обновляется» от «подвисло».
 */

export const updates = $state<{ busy: boolean }>({ busy: false });

/**
 * Срок у проверки. Ответ — файл в пару килобайт, и полминуты без него
 * значат, что сети нет, а не что она медленная.
 */
export const CHECK_TIMEOUT_MS = 30_000;

/**
 * Срок у загрузки — страховка, а не ожидание: без неё загрузка без данных
 * висела бы вечно, а прервать её нельзя. Срок общий, от запроса до последнего
 * байта (так устроен клиент плагина), поэтому щедрый: установщик в шесть
 * мебибайт за пятнадцать минут — это семь килобайт в секунду.
 */
export const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

/**
 * Окно проверки показывается, только если ответ задержался: на хорошей сети
 * он приходит за доли секунды, и мелькнувший диалог был бы шумом.
 */
const CHECK_QUIET_MS = 400;

/** Как часто обновлять секунды на экране. */
const TICK_MS = 1_000;

export const STEPS = ['Скачиваю', 'Проверяю подпись', 'Устанавливаю'];

const DOWNLOAD_FAILED = {
  title: 'Не удалось скачать обновление',
  advice: 'Проверьте подключение к сети. Ничего не установлено.',
};

/**
 * Что сказать об отказе на каждом шаге, по порядку `STEPS`.
 * «Ничего не установлено» верно на всех трёх: установщик запускается
 * последним действием, и отказ на нём значит, что он не запустился.
 */
const FAILURES = [
  DOWNLOAD_FAILED,
  {
    title: 'Обновление не прошло проверку подписи',
    advice:
      'Пакет подписан не нашим ключом или испорчен по дороге. Ничего не установлено.',
  },
  {
    title: 'Не удалось запустить установщик',
    advice:
      'Ничего не установлено. Установщик можно скачать со страницы выпусков: ' +
      'github.com/Mark-Karte/ZeroNote/releases',
  },
];

async function report(title: string, error: unknown, advice: string): Promise<void> {
  await askChoice(title, `${advice}\n\n${String(error)}`, [
    { id: 'ok', label: 'Хорошо', primary: true, cancel: true },
  ]);
}

/**
 * Проверить, есть ли новая версия, и предложить её поставить.
 *
 * Подпись проверяет плагин: пакет, подписанный не нашим ключом, до установки
 * не доходит. Это не тот сертификат, которого у нас нет по Р-007, —
 * у обновлений своя пара ключей, и открытая половина вшита в приложение.
 */
export async function checkForUpdates(): Promise<void> {
  if (updates.busy) return;
  updates.busy = true;

  try {
    let found: Update | null;
    try {
      found = await whileChecking(check({ timeout: CHECK_TIMEOUT_MS }));
    } catch (error) {
      await report('Не удалось проверить обновления', error, 'Проверьте подключение к сети.');
      return;
    }

    if (!found) {
      await askChoice('Обновлений нет', `У вас последняя версия — ${version}.`, [
        { id: 'ok', label: 'Хорошо', primary: true, cancel: true },
      ]);
      return;
    }

    const notes = found.body?.trim();
    const answer = await askChoice(
      'Есть новая версия',
      `Вышла ${found.version}, у вас ${version}.` +
        (notes ? `\n\n${notes}` : '') +
        '\n\nПриложение скачает обновление, закроется, поставит его ' +
        'и откроется снова.',
      [
        { id: 'later', label: 'Не сейчас', cancel: true, primary: true },
        { id: 'install', label: 'Установить' },
      ],
    );

    if (answer !== 'install') return;

    await install(found);
  } finally {
    updates.busy = false;
  }
}

/**
 * Дождаться ответа на проверку, показывая ожидание, если оно затянулось.
 *
 * Без этого вызов из палитры команд не показывал ничего вовсе: надпись
 * «Проверяю…» есть только на кнопке в параметрах.
 */
async function whileChecking<T>(request: Promise<T>): Promise<T> {
  const started = Date.now();
  let close = (): void => {};
  let tick: ReturnType<typeof setInterval> | undefined;

  const delay = setTimeout(() => {
    const shown = showProgress({
      title: 'Проверяю обновления',
      text: 'Спрашиваю GitHub, вышла ли новая версия.',
      steps: [],
      step: 0,
      fraction: null,
      detail: waitingText(Date.now() - started, CHECK_TIMEOUT_MS),
      warning: '',
    });
    close = shown.close;
    tick = setInterval(() => {
      shown.view.detail = waitingText(Date.now() - started, CHECK_TIMEOUT_MS);
    }, TICK_MS);
  }, CHECK_QUIET_MS);

  try {
    return await request;
  } finally {
    clearTimeout(delay);
    clearInterval(tick);
    close();
  }
}

/**
 * Скачать, проверить подпись, поставить — на глазах.
 *
 * Загрузка и установка — два вызова, а не `downloadAndInstall`, и ради
 * трёх шагов на экране это необходимо: плагин сообщает `Finished` после
 * последнего куска, но **до** проверки подписи, а о конце проверки
 * сообщает только возвратом из `download`. Установка на Windows запускает
 * установщик и завершает процесс — сюда управление уже не вернётся.
 *
 * Отмены нет: плагин не умеет прерывать загрузку. Взамен — срок и слова
 * о тишине в сети со сроком, через который загрузка сдастся сама.
 */
async function install(found: Update): Promise<void> {
  const { view, close } = showProgress({
    title: `Обновление до ${found.version}`,
    text:
      'Прервать загрузку нельзя — так устроен механизм обновления. Когда всё ' +
      'скачается, окно закроется, установщик покажет свой ход, и ZeroNote ' +
      'откроется снова.',
    steps: [...STEPS],
    step: 0,
    fraction: null,
    detail: '',
    warning: '',
  });

  let download = startDownload(Date.now());
  const render = (): void => {
    const shown = downloadView(download, Date.now(), DOWNLOAD_TIMEOUT_MS);
    view.fraction = shown.fraction;
    view.detail = shown.amount;
    view.warning = shown.stall;
  };
  render();
  const tick = setInterval(render, TICK_MS);

  try {
    await found.download(
      (event: DownloadEvent) => {
        download = onDownloadEvent(download, event, Date.now());
        if (event.event !== 'Finished') {
          render();
          return;
        }

        // Последний кусок пришёл — дальше подпись. Секунды больше не нужны:
        // проверка идёт на месте и не зависит от сети.
        clearInterval(tick);
        view.step = 1;
        view.fraction = 1;
        view.warning = '';
        view.detail = finishedText(download, Date.now());
      },
      { timeout: DOWNLOAD_TIMEOUT_MS },
    );

    clearInterval(tick);
    view.step = 2;
    view.fraction = 1;
    view.warning = '';
    view.detail = 'Подпись сошлась. Запускаю установщик — окно сейчас закроется.';

    await found.install();
  } catch (error) {
    clearInterval(tick);
    const failure = FAILURES[view.step] ?? DOWNLOAD_FAILED;
    close();
    await report(failure.title, error, failure.advice);
  }
}
