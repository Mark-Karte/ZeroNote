import {
  benchGenOnly,
  benchGenText,
  benchGenBytes,
  benchSinkText,
} from '../ipc/bench';

/**
 * Замер стоимости переноса текста через границу Rust <-> фронтенд.
 *
 * Зачем это нужно: решается вопрос В2 — кто владеет содержимым буфера.
 * Если перенос 10 МБ стоит десятки миллисекунд, источником истины может быть
 * фронтенд, а Rust получает текст целиком при сохранении и сбросе черновика.
 * Если сотни миллисекунд — придётся держать зеркало документа в Rust и гонять
 * через границу только дельты, что заметно дороже в реализации.
 *
 * Методика: каждый замер выполняется `RUNS` раз, берётся медиана.
 * Из времени `gen_text` вычитается `gen_only` — так из результата уходит
 * стоимость генерации данных и остаётся стоимость собственно переноса.
 */

const RUNS = 7;
const SIZES_MIB = [1, 5, 10];

export interface Row {
  sizeMib: number;
  cyrillic: boolean;
  /** Генерация в Rust без переноса — базовая линия, мс. */
  genMs: number;
  /** Rust -> фронтенд через штатный JSON-путь Tauri, мс (за вычетом базовой линии). */
  toFrontJsonMs: number;
  /** Rust -> фронтенд сырыми байтами + TextDecoder, мс (за вычетом базовой линии). */
  toFrontBytesMs: number;
  /** Фронтенд -> Rust, аргумент команды, мс. */
  toCoreMs: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Длина всегда нечётная (RUNS), поэтому середина существует.
  return sorted[mid] ?? Number.NaN;
}

async function timeMedian(fn: () => Promise<unknown>): Promise<number> {
  const samples: number[] = [];
  // Прогревочный проход: первый вызов оплачивает разовые расходы рантайма.
  await fn();
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

export async function runIpcSuite(
  onProgress?: (message: string) => void,
): Promise<Row[]> {
  const rows: Row[] = [];
  const decoder = new TextDecoder('utf-8');

  for (const cyrillic of [false, true]) {
    for (const sizeMib of SIZES_MIB) {
      const label = `${sizeMib} МиБ, ${cyrillic ? 'кириллица' : 'ASCII'}`;
      onProgress?.(label);

      const genMs = await timeMedian(() => benchGenOnly(sizeMib, cyrillic));
      const jsonTotal = await timeMedian(() => benchGenText(sizeMib, cyrillic));
      const bytesTotal = await timeMedian(async () => {
        const buf = await benchGenBytes(sizeMib, cyrillic);
        // Декодирование входит в стоимость: без него байты бесполезны редактору.
        decoder.decode(new Uint8Array(buf));
      });

      // Текст для обратного направления готовим один раз и вне замера.
      const payload = await benchGenText(sizeMib, cyrillic);
      const toCoreMs = await timeMedian(() => benchSinkText(payload));

      rows.push({
        sizeMib,
        cyrillic,
        genMs,
        toFrontJsonMs: jsonTotal - genMs,
        toFrontBytesMs: bytesTotal - genMs,
        toCoreMs,
      });
    }
  }

  return rows;
}

export function formatMarkdown(rows: Row[]): string {
  const fmt = (n: number) => (n < 0 ? '0' : n.toFixed(1));
  const lines = [
    '| Размер | Данные | Генерация в Rust | Rust -> фронт (JSON) | Rust -> фронт (байты) | Фронт -> Rust |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.sizeMib} МиБ | ${r.cyrillic ? 'кириллица' : 'ASCII'} | ${fmt(r.genMs)} мс | ${fmt(r.toFrontJsonMs)} мс | ${fmt(r.toFrontBytesMs)} мс | ${fmt(r.toCoreMs)} мс |`,
    );
  }
  return lines.join('\n');
}
