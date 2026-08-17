import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { languageById } from '../editor/langs';
import { syntaxColors } from '../theme/syntax';

/**
 * Замер подсветки синтаксиса.
 *
 * Зачем: решение Р-042 держится на обещании, что разбор во фронтенде не мешает
 * вводу (инвариант 6). Обещание надо проверять числом, а не верой.
 *
 * Что меряется — то, что чувствует пользователь:
 *
 * * **Открытие** — от создания состояния до первого нарисованного кадра.
 *   Lezer разбирает видимую часть и откладывает остальное, поэтому число
 *   почти не зависит от размера файла; если зависит — обещание нарушено.
 * * **Ввод символа** — вставка одного знака в середину документа. Меряется
 *   двумя числами, и это важно:
 *
 *   * *правка* — синхронная часть: обновление состояния и разметки. Ровно она
 *     задерживает обработку следующего нажатия, и ровно её надо держать
 *     маленькой;
 *   * *до кадра* — то же плюс ожидание ближайшего кадра. Меньше времени кадра
 *     (около 17 мс) это число быть не может по устройству экрана, поэтому
 *     выдавать его за задержку ввода нельзя — иначе любой замер покажет
 *     «медленно» там, где всё мгновенно.
 *
 * Представление настоящее, а не отсоединённое: разбор в CodeMirror привязан
 * к видимой области, и замер на состоянии без представления мерил бы не то.
 */

const RUNS = 21;
const SIZES_MIB = [1, 5, 10];

/** Правдоподобный код на C++: подсветка должна работать, а не скучать. */
const SAMPLE = `// Комментарий к функции обработки
#include <vector>
#include <string>

namespace проект {

class Обработчик {
public:
    explicit Обработчик(const std::string& имя) : имя_(имя), счёт_(0) {}

    int обработать(const std::vector<int>& данные) {
        for (const auto& значение : данные) {
            if (значение > 0 && значение < 1000) {
                счёт_ += значение * 2;
            }
        }
        return счёт_;
    }

private:
    std::string имя_;
    int счёт_ = 0;
};

}  // namespace проект
`;

export interface Row {
  sizeMib: number;
  language: string;
  /** Создание состояния и первый кадр, мс. */
  openMs: number;
  /** Синхронная часть вставки символа, медиана, мс. */
  editMs: number;
  /** Худшая синхронная вставка: подвисание заметно именно им. */
  editWorstMs: number;
  /** Вставка вместе с ожиданием кадра, медиана, мс. */
  frameMs: number;
  lines: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
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

/** Дождаться кадра: без этого замер закончится до отрисовки. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export async function runHighlightSuite(): Promise<Row[]> {
  const language = languageById('cpp');
  if (!language) throw new Error('в реестре нет языка cpp');
  const support = await language.load();

  // Область под представление настоящая, но за пределами экрана: замер не
  // должен перерисовывать интерфейс приложения.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px';
  document.body.appendChild(host);

  const rows: Row[] = [];

  try {
    for (const mib of SIZES_MIB) {
      const doc = makeDoc(mib);

      const start = performance.now();
      const view = new EditorView({
        state: EditorState.create({ doc, extensions: [support, syntaxColors] }),
        parent: host,
      });
      await nextFrame();
      const openMs = performance.now() - start;

      // Ввод в середину документа: там разбор уже не «в начале файла»,
      // и любая зависимость от размера проявится.
      const at = Math.floor(view.state.doc.length / 2);
      view.dispatch({ selection: { anchor: at } });
      await nextFrame();

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

      rows.push({
        sizeMib: mib,
        language: language.label,
        openMs,
        editMs: median(edits),
        editWorstMs: Math.max(...edits),
        frameMs: median(frames),
        lines: view.state.doc.lines,
      });

      view.destroy();
    }
  } finally {
    host.remove();
  }

  return rows;
}

export function formatMarkdown(rows: Row[]): string {
  const lines = [
    '| Размер | Язык | Строк | Открытие | Правка (медиана) | Правка (худшая) | До кадра |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.sizeMib} МиБ | ${r.language} | ${r.lines} | ${r.openMs.toFixed(0)} мс |` +
        ` ${r.editMs.toFixed(1)} мс | ${r.editWorstMs.toFixed(1)} мс |` +
        ` ${r.frameMs.toFixed(1)} мс |`,
    );
  }
  lines.push('');
  lines.push('«Правка» — синхронная часть: она задерживает обработку следующего');
  lines.push('нажатия. «До кадра» включает ожидание ближайшего кадра и меньше');
  lines.push('времени кадра быть не может — это свойство экрана, а не редактора.');
  lines.push('');
  lines.push('Разбор идёт от видимой области и откладывает остальное, поэтому');
  lines.push('цифры почти не зависят от размера файла. Зависимость означала бы,');
  lines.push('что обещание решения Р-042 нарушено.');
  return lines.join('\n');
}
