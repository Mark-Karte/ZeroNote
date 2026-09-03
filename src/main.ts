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

// Шрифты объявляются первыми: к моменту первой отрисовки браузер уже знает,
// откуда их брать, и кадра системным шрифтом не бывает.
import './theme/fonts.css';
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
    config.mode === 'highlight' ||
    config.mode === 'live'
  ) {
    let report: string;
    try {
      report = await runBench(config.mode);
    } catch (error) {
      // Стенд, упавший молча, — худший из возможных: процесс остаётся жить,
      // perf.ps1 ждёт файла, и выглядит это как «замер идёт». Поэтому ошибка
      // становится отчётом.
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      report = `ЗАМЕР НЕ ВЫПОЛНЕН\n\n${detail}\n`;
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

async function runBench(mode: string): Promise<string> {
  if (mode === 'open') return benchRunOpen();
  if (mode === 'tree') return benchRunTree();
  if (mode === 'index') return benchRunIndex();

  if (mode === 'live') {
    // Инвариант 6: ввод под настоящей фоновой индексацией.
    const suite = await import('./bench/live-suite');
    return suite.formatMarkdown(await suite.runLiveSuite());
  }

  if (mode === 'highlight') {
    // Замер целиком во фронтенде: подсветка живёт здесь (Р-042),
    // и границы IPC в этом пути нет.
    const suite = await import('./bench/highlight-suite');
    return suite.formatMarkdown(await suite.runHighlightSuite());
  }

  const suite = await import('./bench/ipc-suite');
  return suite.formatMarkdown(await suite.runIpcSuite());
}

void main();
