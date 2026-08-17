import { mount } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App.svelte';
import {
  benchConfig,
  benchReady,
  benchRunOpen,
  benchRunTree,
  benchRunIndex,
  benchWriteReport,
  benchExit,
} from './ipc/bench';
import { benchReport } from './bench/report-state.svelte';
import { startAppearance } from './theme/store.svelte';

import './theme/tokens.css';
import './theme/base.css';

/**
 * Ждём кадр после монтирования. `requestAnimationFrame` срабатывает перед
 * отрисовкой, поэтому нужен двойной кадр: к моменту второго вызова браузер
 * уже показал первый кадр на экране. Это и есть честная точка
 * «пользователь видит окно и может печатать».
 */
function afterFirstPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function main(): Promise<void> {
  const config = await benchConfig();

  // Оформление применяется до монтирования: так интерфейс сразу рисуется
  // в нужной теме и не мигает светлой заготовкой из tokens.css.
  await startAppearance();

  mount(App, { target: document.getElementById('app')! });

  await afterFirstPaint();

  // Окно создаётся скрытым и показывается ровно здесь. Так пользователь не
  // видит белую вспышку пустого вебвью, а замер старта включает показ окна.
  await getCurrentWindow().show();

  const startupMs = await benchReady();

  if (
    config.mode === 'ipc' ||
    config.mode === 'open' ||
    config.mode === 'tree' ||
    config.mode === 'index' ||
    config.mode === 'highlight'
  ) {
    let report: string;
    if (config.mode === 'open') {
      report = await benchRunOpen();
    } else if (config.mode === 'tree') {
      report = await benchRunTree();
    } else if (config.mode === 'index') {
      report = await benchRunIndex();
    } else if (config.mode === 'highlight') {
      // Замер целиком во фронтенде: подсветка живёт здесь (Р-042),
      // и границы IPC в этом пути нет.
      report = await import('./bench/highlight-suite').then(async (suite) =>
        suite.formatMarkdown(await suite.runHighlightSuite()),
      );
    } else {
      report = await import('./bench/ipc-suite').then(async (suite) =>
        suite.formatMarkdown(await suite.runIpcSuite()),
      );
    }

    if (config.outPath) {
      await benchWriteReport(config.outPath, report);
      await benchExit();
    } else {
      benchReport.text = report;
    }
    return;
  }

  if (config.mode === 'startup') {
    // Ядро уже записало число и завершает процесс внутри bench_ready.
    return;
  }

  // Обычный запуск. Число доступно в консоли разработчика для быстрой проверки
  // без прогона стенда.
  console.info(`ZeroNote: готов к вводу за ${startupMs} мс`);
}

void main();
