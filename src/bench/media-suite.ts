import * as ipc from '../ipc/files';
import { benchMakeMedia, type MediaSample } from '../ipc/bench';

/**
 * Замер показа картинки и PDF — то, ради чего делался этап 10.
 *
 * Путь берётся пользовательский (Р-102): файл открывается тем же
 * `open_file`, каким его открывает щелчок в дереве, и байты спрашиваются
 * теми же командами, какими их спрашивает показ. Мерить в обход приложения
 * значило бы мерить не то.
 *
 * **Разбор PDF в замер не входит**, и это сказано прямо: осмысленное число
 * про pdf.js даёт только настоящий документ со шрифтами и векторами,
 * а настоящий документ невоспроизводим на чужой машине. Здесь меряется то,
 * что написали мы, — чтение файла и доставка байтов в окно.
 */

/** Сколько раз повторяется доставка. Берётся медиана. */
const RUNS = 5;

export interface MediaRow {
  kind: string;
  label: string;
  weight: string;
  /** Доставка байтов из ядра в окно, медиана. */
  deliverMs: number;
  /**
   * Разбор картинки движком — только первый раз.
   *
   * Повторный замер измерял бы кэш движка, а не разбор: адрес `data:` служит
   * ключом, и второй раз картинка приходит уже разобранной.
   */
  decodeMs: number | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return Number.NaN;
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function weightOf(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} МиБ`;
}

async function measureImage(sample: MediaSample): Promise<MediaRow> {
  const opened = await ipc.openFile(sample.path);

  // Прогрев: первое чтение оплачивает попадание файла в кэш системы.
  const first = await ipc.imageSource(opened.id);

  const decodeStart = performance.now();
  const image = new Image();
  image.src = first;
  await image.decode();
  const decodeMs = performance.now() - decodeStart;

  const deliveries: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    await ipc.imageSource(opened.id);
    deliveries.push(performance.now() - start);
  }

  await ipc.closeBuffer(opened.id);

  return {
    kind: 'Картинка',
    label: sample.label,
    weight: weightOf(sample.bytes),
    deliverMs: median(deliveries),
    decodeMs,
  };
}

async function measurePdf(sample: MediaSample): Promise<MediaRow> {
  const opened = await ipc.openFile(sample.path);

  await ipc.pdfBytes(opened.id);

  const deliveries: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    await ipc.pdfBytes(opened.id);
    deliveries.push(performance.now() - start);
  }

  await ipc.closeBuffer(opened.id);

  return {
    kind: 'PDF',
    label: sample.label,
    weight: weightOf(sample.bytes),
    deliverMs: median(deliveries),
    decodeMs: null,
  };
}

export async function runMediaSuite(): Promise<MediaRow[]> {
  const samples = await benchMakeMedia();
  const rows: MediaRow[] = [];

  for (const sample of samples) {
    rows.push(sample.kind === 'image' ? await measureImage(sample) : await measurePdf(sample));
  }

  return rows;
}

export function formatMarkdown(rows: MediaRow[]): string {
  const lines = [
    '| Что | Образец | Вес | Доставка в окно | Разбор движком |',
    '|---|---|---|---|---|',
  ];

  for (const row of rows) {
    const decode = row.decodeMs === null ? '—' : `${row.decodeMs.toFixed(0)} мс`;
    lines.push(
      `| ${row.kind} | ${row.label} | ${row.weight} | ` +
        `${row.deliverMs.toFixed(0)} мс | ${decode} |`,
    );
  }

  lines.push('');
  lines.push(
    'Доставка — медиана из пяти: чтение файла ядром, кодирование и передача ' +
      'в окно. У картинки это адрес `data:` (Р-196), у PDF — двоичный ответ.',
  );
  lines.push('');
  lines.push(
    'Разбор движком меряется **один раз**: адрес `data:` служит ключом кэша, ' +
      'и второй раз картинка приходит уже разобранной. У PDF разбор ' +
      'не меряется вовсе — см. пояснение в `bench_make_media`.',
  );

  return lines.join('\n');
}
