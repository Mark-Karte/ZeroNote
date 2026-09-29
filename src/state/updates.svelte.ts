import {
  cancelUpdate,
  checkUpdate,
  downloadUpdate,
  installUpdate,
  type CheckOutcome,
} from '../ipc/update';
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
import { language, t } from '../l10n';
import { notesFor } from '../ui/release-notes';

/**
 * Обновление из GitHub.
 *
 * Единственное место во всём приложении, где открывается сетевое соединение,
 * и открывается оно только по нажатию (Р-118). Ни фоновой проверки, ни
 * расписания: приложение, которое ходит в сеть само, обязано об этом
 * спрашивать, а мы обошлись без вопроса, обойдясь без хождения.
 *
 * Запрос делает ядро, а не вебвью (`commands/update.rs`). Поэтому политика
 * безопасности окна остаётся прежней — вебвью по-прежнему не открывает
 * ни одного соединения. Там же живёт отмена: снять загрузку умеет только
 * ядро (Р-257).
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
 * Срок у загрузки — страховка для того, кто ушёл от экрана: без неё загрузка
 * без данных висела бы вечно. Срок общий, от запроса до последнего байта
 * (так устроен клиент плагина), поэтому щедрый: установщик в шесть мебибайт
 * за пятнадцать минут — это семь килобайт в секунду.
 */
export const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

/**
 * Окно проверки показывается, только если ответ задержался: на хорошей сети
 * он приходит за доли секунды, и мелькнувший диалог был бы шумом.
 */
const CHECK_QUIET_MS = 400;

/** Как часто обновлять секунды на экране. */
const TICK_MS = 1_000;

/** Шаги установки на экране — функцией: подписи на языке окна. */
function steps(): string[] {
  return [t('updates.step.download'), t('updates.step.verify'), t('updates.step.install')];
}

/**
 * Что сказать об отказе на каждом шаге, по порядку `steps()`.
 * «Ничего не установлено» верно на всех трёх: установщик запускается
 * последним действием, и отказ на нём значит, что он не запустился.
 */
function failure(step: number): { title: string; advice: string } {
  switch (step) {
    case 1:
      return {
        title: t('updates.signature.failed'),
        advice: t('updates.signature.failed.advice'),
      };
    case 2:
      return {
        title: t('updates.installer.failed'),
        advice: t('updates.installer.failed.advice'),
      };
    default:
      return {
        title: t('updates.download.failed'),
        advice: t('updates.download.failed.advice'),
      };
  }
}

async function report(title: string, error: unknown, advice: string): Promise<void> {
  await askChoice(title, `${advice}\n\n${String(error)}`, [
    { id: 'ok', label: t('common.ok'), primary: true, cancel: true },
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
    let found: CheckOutcome;
    try {
      found = await whileChecking(checkUpdate(CHECK_TIMEOUT_MS));
    } catch (error) {
      await report(t('updates.check.failed'), error, t('updates.check.failed.advice'));
      return;
    }

    // Отменили сами — сказать нечего.
    if (found.kind === 'cancelled') return;

    if (found.kind === 'upToDate') {
      await askChoice(t('updates.none'), t('updates.none.text', { version }), [
        { id: 'ok', label: t('common.ok'), primary: true, cancel: true },
      ]);
      return;
    }

    // Заметки двуязычные (задача 156) — показывается часть на языке окна.
    const notes = notesFor(found.notes ?? '', language());
    const answer = await askChoice(
      t('updates.found'),
      t('updates.found.versions', { found: found.version, current: version }) +
        (notes ? `\n\n${notes}` : '') +
        `\n\n${t('updates.found.how')}`,
      [
        { id: 'later', label: t('updates.later'), cancel: true, primary: true },
        { id: 'install', label: t('updates.install') },
      ],
    );

    if (answer !== 'install') return;

    await install(found.version);
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
      title: t('updates.checking'),
      text: t('updates.checking.text'),
      steps: [],
      step: 0,
      fraction: null,
      detail: waitingText(Date.now() - started, CHECK_TIMEOUT_MS),
      warning: '',
      cancel: () => void cancelUpdate(),
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
 * Загрузка и установка — два вызова, и ради трёх шагов на экране это
 * необходимо: плагин сообщает `Finished` после последнего куска, но **до**
 * проверки подписи, а о конце проверки сообщает только возвратом
 * из загрузки. Установка на Windows запускает установщик и завершает
 * процесс — сюда управление уже не вернётся.
 *
 * Отменить можно, пока идёт загрузка: ядро снимает её, и соединение
 * закрывается (Р-257). Проверку подписи и установку — нельзя: первая идёт
 * на месте за доли секунды, вторая заменяет само приложение.
 */
async function install(target: string): Promise<void> {
  const { view, close } = showProgress({
    title: t('updates.installing.title', { version: target }),
    text: t('updates.installing.text'),
    steps: steps(),
    step: 0,
    fraction: null,
    detail: '',
    warning: '',
    cancel: null,
  });

  // Отмена видна сразу, не дожидаясь ответа ядра: кнопка гаснет, а строка
  // говорит, что происходит. Снимается загрузка мгновенно — задача
  // просыпается ради отмены, даже если сеть молчит.
  let cancelling = false;
  view.cancel = () => {
    cancelling = true;
    view.cancel = null;
    view.warning = '';
    view.detail = t('updates.cancelling');
    void cancelUpdate();
  };

  let download = startDownload(Date.now());
  const render = (): void => {
    // Сообщение, опоздавшее к концу загрузки, шаг назад не отматывает.
    if (view.step !== 0 || cancelling) return;
    const shown = downloadView(download, Date.now(), DOWNLOAD_TIMEOUT_MS);
    view.fraction = shown.fraction;
    view.detail = shown.amount;
    view.warning = shown.stall;
  };
  render();
  const tick = setInterval(render, TICK_MS);

  try {
    const outcome = await downloadUpdate(DOWNLOAD_TIMEOUT_MS, (event: DownloadEvent) => {
      download = onDownloadEvent(download, event, Date.now());
      if (event.event !== 'Finished') {
        render();
        return;
      }
      if (view.step !== 0 || cancelling) return;

      // Последний кусок пришёл — дальше подпись. Секунды больше не нужны:
      // проверка идёт на месте и не зависит от сети. Отменять уже нечего.
      clearInterval(tick);
      view.step = 1;
      view.fraction = 1;
      view.warning = '';
      view.cancel = null;
      view.detail = finishedText(download, Date.now());
    });

    clearInterval(tick);
    // Отмена, нажатая в тот миг, когда загрузка уже кончилась, всё равно
    // отмена: ядро успело ответить «готово», но человек сказал «не надо».
    if (outcome === 'cancelled' || cancelling) {
      close();
      return;
    }

    view.step = 2;
    view.fraction = 1;
    view.warning = '';
    view.cancel = null;
    view.detail = t('updates.launching');

    await installUpdate();
  } catch (error) {
    clearInterval(tick);
    const failed = failure(view.step);
    close();
    await report(failed.title, error, failed.advice);
  }
}
