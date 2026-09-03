import { tick } from 'svelte';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { syntaxTree, type LanguageSupport } from '@codemirror/language';

import { languageById } from '../editor/langs';
import { editorView } from '../editor/current';
import { syntaxColors } from '../theme/syntax';
import { benchStartIndex, benchStopIndex } from '../ipc/bench';
import { indexProgress } from '../ipc/index';
import {
  activeTab,
  tabs,
  close,
  createEmpty,
  sessionRestored,
  setLanguage,
} from '../state/tabs.svelte';

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
 *
 * **Ввод идёт через настоящую вкладку** (задача 30, решение Р-102). До неё
 * стенд печатал в собственный `EditorView`, не связанный с состоянием вкладки,
 * и всё, что приложение делает на каждое изменение — обновление вкладки,
 * пересчёт строки состояния, отложенный черновик, перерисовка, — в измерение
 * не попадало вовсе. Числа были верные, но отвечали не на тот вопрос.
 *
 * Первой строкой остался прежний путь — ввод мимо приложения. Он здесь
 * не ради истории, а как база: разница между ним и вводом через вкладку и есть
 * цена собственной обвязки, и увидеть её можно только рядом.
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
  /** Что мерили: каким путём и в каких условиях. */
  what: string;
  /** Синхронная часть вставки символа, медиана, мс. */
  editMs: number;
  /** Худшая синхронная вставка. */
  editWorstMs: number;
  /**
   * Вставка вместе с ожиданием ближайшего кадра, медиана, мс.
   *
   * Сюда попадает всё, что приложение успевает сделать до отрисовки:
   * обновление вкладки, пересчёт строки состояния, работа Svelte. Меньше
   * времени кадра это число быть не может — свойство экрана, не редактора.
   */
  frameMs: number;
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

interface Samples {
  edits: number[];
  frames: number[];
}

/** Вставить символ RUNS раз, вернув синхронные времена и времена до кадра. */
async function typeInto(view: EditorView): Promise<Samples> {
  const edits: number[] = [];
  const frames: number[] = [];

  for (let i = 0; i < RUNS; i += 1) {
    const from = view.state.selection.main.head;
    const began = performance.now();
    view.dispatch({ changes: { from, insert: 'x' } });
    edits.push(performance.now() - began);
    await nextFrame();
    frames.push(performance.now() - began);
  }

  return { edits, frames };
}

function row(what: string, samples: Samples): Row {
  return {
    what,
    editMs: median(samples.edits),
    editWorstMs: Math.max(...samples.edits),
    frameMs: median(samples.frames),
  };
}

/**
 * Дождаться обещания или сказать, чего не дождались.
 *
 * Без ограничения по времени стенд, попавший в непредвиденное состояние,
 * просто висит, и снаружи это выглядит как «замер идёт».
 */
function waitFor(promise: Promise<void>, ms: number, what: string): Promise<void> {
  return Promise.race([
    promise,
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error(`${what} за ${ms} мс`)), ms);
    }),
  ]);
}

/** Поставить курсор в середину: там разбор уже не «в начале файла». */
async function toMiddle(view: EditorView): Promise<void> {
  view.dispatch({ selection: { anchor: Math.floor(view.state.doc.length / 2) } });
  await nextFrame();
}

/**
 * Прежний путь: свой `EditorView` мимо приложения.
 *
 * Нужен как база для сравнения — и ровно поэтому набор расширений здесь
 * минимальный, только язык и цвета.
 */
async function measureBare(support: LanguageSupport, doc: string): Promise<Samples> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px';
  document.body.appendChild(host);

  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [support, syntaxColors],
    }),
    parent: host,
  });

  try {
    await toMiddle(view);
    return await typeInto(view);
  } finally {
    view.destroy();
    host.remove();
  }
}

/**
 * Открыть настоящую вкладку и дождаться, когда она окажется в редакторе.
 *
 * Ждать приходится дважды и по-разному: состояние вкладки доезжает
 * до представления эффектом Svelte, а язык подсветки грузится отдельно
 * и встаёт на место через отсек. Начать мерить раньше — значит померить
 * догрузку языка вместо ввода.
 */
async function openRealTab(
  doc: string,
  born: (id: number) => void,
): Promise<{ id: number; view: EditorView }> {
  // Сначала дожидаемся конца восстановления сессии. Иначе оно заменит список
  // вкладок целиком уже после того, как мы создали свою, — и мерить будем
  // чужой буфер, ничего не заметив.
  await waitFor(sessionRestored, 30_000, 'приложение не закончило восстановление сессии');

  const before = new Set(tabs.items.map((t) => t.meta.id));
  await createEmpty(doc);

  const tab = activeTab();
  if (!tab) throw new Error('вкладка не открылась');
  const id = tab.meta.id;
  // Номер сообщаем первым делом, до всех проверок: вкладка уже существует,
  // и закрыть её надо в любом случае. Пока это стояло ниже, сорвавшиеся
  // прогоны оставляли после себя по вкладке в сессии.
  born(id);

  // Проверка условий, а не веры: дальше идёт ожидание, и если текст потерялся
  // уже здесь, ждать его бессмысленно, а сообщение будет не про то.
  if (tab.editor.doc.length !== doc.length) {
    const all = tabs.items
      .map((t) => `${t.meta.id}${before.has(t.meta.id) ? '' : '(новая)'}:${t.editor.doc.length}`)
      .join(', ');
    throw new Error(
      `вкладка создана пустой: в активной ${tab.editor.doc.length} знаков вместо ${doc.length};` +
        ` активная ${tabs.activeId}; все вкладки — ${all}`,
    );
  }
  // Буфер без файла на диске имени языка не подсказывает, а мерить надо
  // с подсветкой: без неё сравнение с базовой линией теряет смысл.
  setLanguage(id, 'cpp');

  // Состояние доезжает до представления эффектом Svelte, а тот выполняется
  // не сразу. `tick` — документированный способ дождаться, а не надеяться,
  // что хватит кадра.
  await tick();

  for (let attempt = 0; attempt < 600; attempt += 1) {
    const view = editorView();
    if (
      view &&
      view.state.doc.length === doc.length &&
      // Пустое дерево — язык ещё не приехал.
      syntaxTree(view.state).length > 0
    ) {
      return { id, view };
    }
    await nextFrame();
  }

  // Отказ обязан сказать, чего именно не дождались: «не получилось» здесь
  // означало бы час на догадки.
  const view = editorView();
  const seen = view
    ? `в представлении ${view.state.doc.length} знаков, дерево ${syntaxTree(view.state).length}`
    : 'представления нет вовсе';
  const inTab = activeTab()?.editor.doc.length ?? -1;
  throw new Error(
    `редактор не принял документ вкладки: ожидали ${doc.length} знаков, ${seen};` +
      ` в состоянии вкладки ${inTab};` +
      ` активная вкладка ${activeTab()?.meta.id ?? 'нет'}, ждали её ${id}`,
  );
}

export async function runLiveSuite(): Promise<Result> {
  const language = languageById('cpp');
  if (!language) throw new Error('в реестре нет языка cpp');
  const support = await language.load();

  const doc = makeDoc(DOC_MIB);
  const rows: Row[] = [];
  let indexedDuring = 0;
  let valid = false;
  let note = '';
  let fixture: string | null = null;
  let tabId: number | null = null;

  try {
    // База: тот же ввод, но мимо приложения. Разница со следующей строкой
    // и есть цена вкладки, строки состояния и перерисовки.
    rows.push(row('мимо приложения, в покое', await measureBare(support, doc)));

    const real = await openRealTab(doc, (id) => {
      tabId = id;
    });
    await toMiddle(real.view);

    rows.push(row('через вкладку, в покое', await typeInto(real.view)));

    fixture = await benchStartIndex();

    // Ждём, пока индексация действительно пойдёт: задание уходит в очередь,
    // и первые миллисекунды рабочий поток ещё обходит папки.
    const startedAt = performance.now();
    let before = await indexProgress();
    while (!before.running && performance.now() - startedAt < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      before = await indexProgress();
    }

    const busy = await typeInto(real.view);
    const after = await indexProgress();

    rows.push(row('через вкладку, во время индексации', busy));

    indexedDuring = Math.max(0, after.done - before.done);

    // Замер достоверен, только если индексация шла и в начале, и в конце.
    // Иначе мы померили покой и назвали его нагрузкой.
    valid = before.running && after.running;
    note = valid
      ? `За время измерения проиндексировано файлов: ${indexedDuring}.`
      : 'НЕДОСТОВЕРНО: индексация не шла всё время измерения.';
  } finally {
    // Вкладку за собой убираем: стенд не должен оставлять в сессии
    // мегабайт несохранённого текста.
    if (tabId !== null) await close(tabId);
    if (fixture !== null) await benchStopIndex(fixture);
  }

  return { rows, indexedDuring, valid, note };
}

export function formatMarkdown(result: Result): string {
  const lines = [
    '| Что | Правка (медиана) | Правка (худшая) | До кадра |',
    '|---|---|---|---|',
  ];
  for (const row of result.rows) {
    lines.push(
      `| ${row.what} | ${row.editMs.toFixed(1)} мс | ${row.editWorstMs.toFixed(1)} мс` +
        ` | ${row.frameMs.toFixed(1)} мс |`,
    );
  }

  lines.push('');
  lines.push(result.note);
  lines.push('');
  lines.push('Индексация настоящая: тот же рабочий поток, та же база, та же');
  lines.push('очередь, что у обычной работы. Совпадение по времени проверяется —');
  lines.push('замер, где индексация успела закончиться, объявляется недостоверным.');
  lines.push('');
  lines.push('Ввод идёт через настоящую вкладку, поэтому в «до кадра» входит всё,');
  lines.push('что приложение делает на каждое изменение: обновление вкладки,');
  lines.push('пересчёт строки состояния, работа Svelte, отрисовка. Первая строка —');
  lines.push('тот же ввод мимо приложения; разница с ней и есть цена обвязки.');
  lines.push('Меньше времени кадра «до кадра» быть не может — свойство экрана.');
  return lines.join('\n');
}
