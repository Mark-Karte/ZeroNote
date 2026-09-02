import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { languageById } from '../editor/langs';
import { syntaxColors } from '../theme/syntax';
import { benchStartIndex, benchStopIndex } from '../ipc/bench';
import { indexProgress } from '../ipc/index';

/**
 * Инвариант 6: ввод не ждёт фоновую работу.
 *
 * На этапе 1 инвариант был закрыт частично и честно помечен: тяжёлой фоновой
 * работы в приложении тогда не было. Теперь есть — индексация хранилища, —
 * и её можно либо закрыть числом, либо признать невыполненной.
 *
 * Замер устроен так, чтобы не мог выдать желаемое за действительное:
 *
 * * индексация настоящая — тот же рабочий поток, та же база, та же очередь;
 * * задержка ввода меряется дважды, в покое и под нагрузкой, одним и тем же
 *   кодом;
 * * **проверяется совпадение по времени**: если индексация успела закончиться
 *   до конца измерения, замер объявляется недостоверным. Без этой проверки
 *   он всегда показывал бы «всё хорошо» — просто потому, что мерил покой.
 */

const RUNS = 41;
const DOC_MIB = 1;

const SAMPLE = `// Обработчик очереди сообщений
#include <string>
#include <vector>

class Очередь {
public:
    void добавить(const std::string& сообщение) {
        буфер_.push_back(сообщение);
        if (буфер_.size() > предел_) {
            буфер_.erase(буфер_.begin());
        }
    }

private:
    std::vector<std::string> буфер_;
    size_t предел_ = 1000;
};
`;

export interface Row {
  /** Что мерили: покой или работу под индексацией. */
  what: string;
  /** Синхронная часть вставки символа, медиана, мс. */
  editMs: number;
  /** Худшая синхронная вставка. */
  editWorstMs: number;
}

export interface Result {
  rows: Row[];
  /** Сколько файлов было проиндексировано за время замера под нагрузкой. */
  indexedDuring: number;
  /** Замер достоверен: индексация шла всё время измерения. */
  valid: boolean;
  note: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function makeDoc(mib: number): string {
  const target = mib * 1024 * 1024;
  const parts: string[] = [];
  let size = 0;
  while (size < target) {
    parts.push(SAMPLE);
    size += SAMPLE.length;
  }
  return parts.join('');
}

/** Вставить символ RUNS раз, вернув синхронные времена. */
async function typeInto(view: EditorView): Promise<number[]> {
  const samples: number[] = [];

  for (let i = 0; i < RUNS; i += 1) {
    const from = view.state.selection.main.head;
    const began = performance.now();
    view.dispatch({ changes: { from, insert: 'x' } });
    samples.push(performance.now() - began);
    await nextFrame();
  }

  return samples;
}

export async function runLiveSuite(): Promise<Result> {
  const language = languageById('cpp');
  if (!language) throw new Error('в реестре нет языка cpp');
  const support = await language.load();

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px';
  document.body.appendChild(host);

  const view = new EditorView({
    state: EditorState.create({
      doc: makeDoc(DOC_MIB),
      extensions: [support, syntaxColors],
    }),
    parent: host,
  });
  view.dispatch({ selection: { anchor: Math.floor(view.state.doc.length / 2) } });
  await nextFrame();

  const rows: Row[] = [];
  let indexedDuring = 0;
  let valid = false;
  let note = '';
  let fixture: string | null = null;

  try {
    // Покой: с чем сравнивать.
    const idle = await typeInto(view);
    rows.push({
      what: 'в покое',
      editMs: median(idle),
      editWorstMs: Math.max(...idle),
    });

    fixture = await benchStartIndex();

    // Ждём, пока индексация действительно пойдёт: задание уходит в очередь,
    // и первые миллисекунды рабочий поток ещё обходит папки.
    const startedAt = performance.now();
    let before = await indexProgress();
    while (!before.running && performance.now() - startedAt < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      before = await indexProgress();
    }

    const busy = await typeInto(view);
    const after = await indexProgress();

    rows.push({
      what: 'во время индексации',
      editMs: median(busy),
      editWorstMs: Math.max(...busy),
    });

    indexedDuring = Math.max(0, after.done - before.done);

    // Замер достоверен, только если индексация шла и в начале, и в конце.
    // Иначе мы померили покой и назвали его нагрузкой.
    valid = before.running && after.running;
    note = valid
      ? `За время измерения проиндексировано файлов: ${indexedDuring}.`
      : 'НЕДОСТОВЕРНО: индексация не шла всё время измерения.';
  } finally {
    view.destroy();
    host.remove();
    if (fixture !== null) await benchStopIndex(fixture);
  }

  return { rows, indexedDuring, valid, note };
}

export function formatMarkdown(result: Result): string {
  const lines = [
    '| Что | Правка (медиана) | Правка (худшая) |',
    '|---|---|---|',
  ];
  for (const row of result.rows) {
    lines.push(
      `| ${row.what} | ${row.editMs.toFixed(1)} мс | ${row.editWorstMs.toFixed(1)} мс |`,
    );
  }

  lines.push('');
  lines.push(result.note);
  lines.push('');
  lines.push('Индексация настоящая: тот же рабочий поток, та же база, та же');
  lines.push('очередь, что у обычной работы. Совпадение по времени проверяется —');
  lines.push('замер, где индексация успела закончиться, объявляется недостоверным.');
  return lines.join('\n');
}
