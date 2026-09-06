import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { languageById } from '../editor/langs';
import { livePreview } from '../editor/live-preview';
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

/** Движений курсора в пачке: одно дешевле разрешения часов вебвью. */
const CARET_MOVES = 50;

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
  id: string;
  sample: string;
  sizes: number[];
  /** Подпись в таблице, если она отличается от названия языка. */
  label?: string;
  /** Что поставить сверх языка: превью ставится отсеком, здесь — напрямую. */
  extra?: () => Extension[];
}

const CASES: Case[] = [
  { id: 'cpp', sample: CPP, sizes: [1, 5, 10] },
  // Двух размеров хватает, чтобы увидеть зависимость от размера, если она есть.
  { id: 'markdown', sample: MARKDOWN, sizes: [1, 10] },
  // Живое превью — работа, которой до этапа 9 не было (Р-158): украшения
  // пересобираются и на смену выделения, то есть на голое движение курсора.
  // Строка нужна затем, чтобы плату назвать числом, а не словами.
  {
    id: 'markdown',
    sample: MARKDOWN,
    sizes: [1, 10],
    label: 'Markdown + превью',
    extra: () => [livePreview()],
  },
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
  /**
   * Движение курсора на знак, медиана, мс.
   *
   * Правку оно не делает, и до этапа 9 стоило бы ровно ничего. С живым
   * превью (Р-158) на нём пересобираются украшения видимой области —
   * это и есть плата за правило «строка под курсором показывает исходник».
   */
  caretMs: number;
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
          state: EditorState.create({
            doc,
            extensions: [support, syntaxColors, ...(item.extra?.() ?? [])],
          }),
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

        // Голое движение курсора: ни одного изменения документа.
        //
        // Пачкой и делением, а не по одному с медианой, как правка. Причина
        // в инструменте: часы вебвью округляют до 0,1 мс, а одно движение
        // дешевле этого — по одному замеру все строки показывали ровно 0,1,
        // то есть дно шкалы, а не цену работы.
        const caretBegan = performance.now();
        for (let i = 0; i < CARET_MOVES; i += 1) {
          const head = view.state.selection.main.head;
          view.dispatch({ selection: { anchor: head + (i % 2 === 0 ? 1 : -1) } });
        }
        const caretMs = (performance.now() - caretBegan) / CARET_MOVES;

        rows.push({
          sizeMib: mib,
          language: item.label ?? language.label,
          openMs,
          editMs: median(edits),
          editWorstMs: Math.max(...edits),
          frameMs: median(frames),
          caretMs,
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
    '| Размер | Язык | Строк | Открытие | Правка (медиана) | Правка (худшая) | До кадра | Курсор |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.sizeMib} МиБ | ${r.language} | ${r.lines} | ${r.openMs.toFixed(0)} мс |` +
        ` ${r.editMs.toFixed(1)} мс | ${r.editWorstMs.toFixed(1)} мс |` +
        ` ${r.frameMs.toFixed(1)} мс | ${r.caretMs.toFixed(2)} мс |`,
    );
  }
  lines.push('');
  lines.push('«Правка» — синхронная часть: она задерживает обработку следующего');
  lines.push('нажатия. «До кадра» включает ожидание ближайшего кадра и меньше');
  lines.push('времени кадра быть не может — это свойство экрана, а не редактора.');
  lines.push('');
  lines.push('«Курсор» — движение на знак без правки, среднее по пятидесяти');
  lines.push('подряд: одно движение дешевле разрешения часов вебвью (0,1 мс)');
  lines.push('и по одному не меряется вовсе. С живым превью на нём пересобираются');
  lines.push('украшения (Р-158), без превью не происходит ничего — разница строк');
  lines.push('markdown и «Markdown + превью» и есть плата за правило «строка');
  lines.push('под курсором показывает исходник».');
  lines.push('');
  lines.push('Разбор идёт от видимой области и откладывает остальное, поэтому');
  lines.push('цифры почти не зависят от размера файла. Зависимость означала бы,');
  lines.push('что обещание решения Р-042 нарушено.');
  return lines.join('\n');
}
