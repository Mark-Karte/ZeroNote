import { lookupFor } from '../../src/editor/callouts';
import { drawDiagram } from '../../src/editor/diagram';
import { renderDiagram, type DiagramTheme } from '../../src/editor/diagram-render';
import { markdownToHtml } from '../../src/html/convert';

/**
 * Замер отрисовки схем mermaid (задача 117): сколько стоит одна схема
 * и нужен ли предел по размеру.
 *
 * Меряется наш же путь — `renderDiagram`, — в том же движке, что WebView2
 * (безголовый Edge, `bench/diagram.ps1`). Отрисовка идёт в потоке окна
 * целиком: разбор и раскладка mermaid синхронны внутри `render`, и это
 * время окно не отвечает. Его и меряем.
 */

const theme: DiagramTheme = {
  dark: false,
  fontFamily: 'Segoe UI, sans-serif',
  fontSize: '14px',
  background: 'rgb(255, 255, 255)',
  node: 'rgb(246, 248, 250)',
  nodeBorder: 'rgb(9, 105, 218)',
  text: 'rgb(31, 35, 40)',
  line: 'rgb(89, 99, 110)',
  secondary: 'rgb(234, 238, 242)',
  tertiary: 'rgb(246, 248, 250)',
  cluster: 'rgb(246, 248, 250)',
  clusterBorder: 'rgb(208, 215, 222)',
  note: 'rgb(221, 244, 255)',
};

/** Блок-схема из `nodes` узлов: цепочка и ветки через одну. */
function flowchart(nodes: number): string {
  const lines = ['flowchart TD'];
  for (let i = 1; i < nodes; i += 1) {
    lines.push(`    N${i}[Узел ${i}] --> N${i + 1}[Узел ${i + 1}]`);
    if (i % 3 === 0 && i + 3 <= nodes) lines.push(`    N${i} -->|ветка| N${i + 3}`);
  }
  return lines.join('\n');
}

/** Схема последовательности из `messages` сообщений. */
function sequence(messages: number): string {
  const lines = ['sequenceDiagram', '    participant A as Прибор', '    participant B as Компьютер'];
  for (let i = 1; i <= messages; i += 1) {
    lines.push(i % 2 === 0 ? `    B-->>A: ответ ${i}` : `    A->>B: запрос ${i}`);
  }
  return lines.join('\n');
}

const cases: Array<[string, string]> = [
  ['блок-схема, 5 узлов', flowchart(5)],
  ['блок-схема, 30 узлов', flowchart(30)],
  ['блок-схема, 150 узлов', flowchart(150)],
  ['последовательность, 20 сообщений', sequence(20)],
  ['последовательность, 200 сообщений', sequence(200)],
];

async function time(source: string): Promise<number> {
  const start = performance.now();
  await renderDiagram(source, theme);
  return performance.now() - start;
}

/**
 * Документ для печати и экспорта (приёмка этапа 17): заметка со схемами
 * и формулами через `markdownToHtml` — тем же путём, что печать, PDF,
 * экспорт и копирование. Каждый прогон — со своим текстом: готовые
 * схемы и формулы хранятся по тексту, и повтор мерил бы память.
 */
function note(run: string, diagrams: number, formulas: number): string {
  const parts = ['# Заметка', ''];
  for (let i = 0; i < diagrams; i += 1) {
    parts.push('Схема:', '', '```mermaid', `${flowchart(10)}\n%% ${run}-${i}`, '```', '');
  }
  for (let i = 0; i < formulas; i += 1) {
    parts.push(`Формула $V_{\\text{${run}}} = \\frac{R_{${i}}}{R1 + R2} \\times 2^{12}$ в тексте.`, '');
  }
  return parts.join('\n');
}

async function timeNote(text: string): Promise<number> {
  const start = performance.now();
  await markdownToHtml(text, {
    callouts: lookupFor([]),
    sourcePath: null,
    loadImage: async () => '',
    loadEmbed: async () => '',
    drawDiagram: (source) => drawDiagram(source, theme),
  });
  return performance.now() - start;
}

async function main(): Promise<void> {
  const out: string[] = [];
  for (const [diagrams, formulas] of [[0, 50], [5, 0], [5, 50]] as const) {
    const tag = `${diagrams}-${formulas}`;
    const first = await timeNote(note(`${tag}-first`, diagrams, formulas));
    const warm: number[] = [];
    for (let run = 0; run < 5; run += 1) warm.push(await timeNote(note(`${tag}-${run}`, diagrams, formulas)));
    warm.sort((a, b) => a - b);
    out.push(
      `документ: ${diagrams} схем по 10 узлов, ${formulas} формул — первый ${first.toFixed(0)} мс, ` +
        `дальше ${warm[2]!.toFixed(0)} мс (от ${warm[0]!.toFixed(0)} до ${warm[4]!.toFixed(0)})`,
    );
  }
  for (const [name, source] of cases) {
    // Первая отрисовка вида схемы грузит его кусок — она дороже.
    const first = await time(`${source}\n%% первая`);
    const warm: number[] = [];
    for (let run = 0; run < 5; run += 1) warm.push(await time(`${source}\n%% ${run}`));
    warm.sort((a, b) => a - b);
    const median = warm[Math.floor(warm.length / 2)]!;
    out.push(
      `${name} (${source.length} знаков): первая ${first.toFixed(0)} мс, ` +
        `дальше ${median.toFixed(0)} мс (от ${warm[0]!.toFixed(0)} до ${warm[warm.length - 1]!.toFixed(0)})`,
    );
  }
  document.getElementById('out')!.textContent = `ГОТОВО\n${out.join('\n')}`;
}

main().catch((error: unknown) => {
  document.getElementById('out')!.textContent = `ОШИБКА ${String(error)}`;
});
