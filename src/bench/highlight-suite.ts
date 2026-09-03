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

/** Правдоподобный код на C++: подсветка должна работать, а не скучать. */
const CPP = `// Комментарий к функции обработки
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

/**
 * Заметка с блоками кода.
 *
 * Нужна отдельно от C++, потому что в markdown на пути ввода стоит ещё и
 * оформление блоков (задача 28): на каждое изменение оно обходит дерево
 * разбора по видимой области. Обход этот по устройству не зависит от размера
 * файла — а раз «по устройству», значит проверяется числом.
 */
const MARKDOWN = `## Раздел заметки

Обычный текст со [[ссылкой]] и тегом #заметка. Дальше блок кода,
каких в рабочих заметках больше, чем прозы.

\`\`\`rust
fn обработать(данные: &[i32]) -> i32 {
    данные.iter().filter(|v| **v > 0).sum()
}
\`\`\`

Ещё немного текста между блоками.

\`\`\`ps1
Get-ChildItem -Recurse | Where-Object { $_.Length -gt 1024 }
\`\`\`

- пункт списка
- ещё пункт

`;

interface Case {
  /** Идентификатор языка в реестре. */
  id: string;
  sample: string;
  /** Размеры документа, МиБ. */
  sizes: number[];
}

const CASES: Case[] = [
  { id: 'cpp', sample: CPP, sizes: [1, 5, 10] },
  // Двух размеров хватает, чтобы увидеть зависимость от размера, если она есть.
  { id: 'markdown', sample: MARKDOWN, sizes: [1, 10] },
];

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

function makeDoc(sample: string, mib: number): string {
  const target = mib * 1024 * 1024;
  const parts: string[] = [];
  let size = 0;
  while (size < target) {
    parts.push(sample);
    size += sample.length;
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
  // Область под представление настоящая, но за пределами экрана: замер не
  // должен перерисовывать интерфейс приложения.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px';
  document.body.appendChild(host);

  const rows: Row[] = [];

  try {
    for (const item of CASES) {
      const language = languageById(item.id);
      if (!language) throw new Error(`в реестре нет языка ${item.id}`);
      const support = await language.load();

      for (const mib of item.sizes) {
        const doc = makeDoc(item.sample, mib);

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
