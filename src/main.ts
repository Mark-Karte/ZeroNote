import { mount } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App.svelte';
import { benchConfig, benchReady, benchWriteReport, benchExit } from './ipc/bench';

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

  mount(App, { target: document.getElementById('app')! });

  await afterFirstPaint();

  // Окно создаётся скрытым и показывается ровно здесь. Так пользователь не
  // видит белую вспышку пустого вебвью, а замер старта включает показ окна.
  await getCurrentWindow().show();

  const startupMs = await benchReady();

  if (config.mode === 'ipc') {
    const { runIpcSuite, formatMarkdown } = await import('./bench/ipc-suite');
    const rows = await runIpcSuite();
    const report = formatMarkdown(rows);
    if (config.outPath) {
      await benchWriteReport(config.outPath, report);
      await benchExit();
    } else {
      const { benchReport } = await import('./bench/report-state.svelte');
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
