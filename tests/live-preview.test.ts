import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

import { decorateLivePreview, livePreviewOn } from '../src/editor/live-preview';
import { highlightMark } from '../src/editor/markdown-highlight';
import { languages } from '../src/editor/markdown-code';

/**
 * Живое превью: знаки вокруг текста.
 *
 * Проверяется без окна: сборка украшений — работа над состоянием. Главное
 * здесь — правило Р-158 (строка под курсором показывается исходником)
 * и граница между знаком вокруг текста и ограждением блока кода: и то
 * и другое зовётся `CodeMark`.
 */

function state(doc: string, cursor = 0): EditorState {
  const editor = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: [highlightMark],
    }),
  });
  ensureSyntaxTree(editor, editor.doc.length, 5000);
  return editor;
}

/** Что спрятано: куски текста, которых не будет на экране. */
function hiddenParts(doc: string, cursor = 0): string[] {
  const editor = state(doc, cursor);
  const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);
  const out: string[] = [];

  const cursorIter = set.iter();
  while (cursorIter.value !== null) {
    out.push(editor.doc.sliceString(cursorIter.from, cursorIter.to));
    cursorIter.next();
  }
  return out;
}

/**
 * Как строка выглядит на экране: исходник минус спрятанное.
 *
 * Пропускаются только замены. Украшения текста и строки — `zn-callout-title`,
 * `zn-task-text-done` — ничего не прячут, и считать их спрятанным значило бы
 * потерять из показа сам текст задачи (найдено тестом задачи 91).
 */
function shown(doc: string, cursor = 0): string {
  const editor = state(doc, cursor);
  const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);

  let out = '';
  let at = 0;
  const iter = set.iter();
  while (iter.value !== null) {
    const spec = iter.value.spec as { class?: string };
    if (spec.class === undefined) {
      out += editor.doc.sliceString(at, iter.from);
      at = iter.to;
    }
    iter.next();
  }
  return out + editor.doc.sliceString(at);
}

describe('задачи списка (задача 91)', () => {
  /**
   * `[ ]` заменяется переключателем — значит, пропадает из показа. Текст
   * задачи при этом остаётся: прячется знак, а не строка.
   */
  it('знак задачи заменяется переключателем', () => {
    const doc = '- [ ] купить хлеб\n- [x] позвонить\n\n';

    expect(shown(doc, doc.length)).toBe('-  купить хлеб\n-  позвонить\n\n');
    expect(hiddenParts(doc, doc.length)).toContain('[ ]');
    expect(hiddenParts(doc, doc.length)).toContain('[x]');
  });

  /** Правило Р-158 действует и здесь: под курсором стоит исходник. */
  it('на строке под курсором остаётся исходник', () => {
    const doc = '- [ ] первая\n- [ ] вторая\n';

    expect(shown(doc, 0)).toBe('- [ ] первая\n-  вторая\n');
  });

  /**
   * `[ ]` посреди обычного текста — не задача: GFM считает задачей только
   * начало элемента списка, и своего разбора здесь не нужно.
   */
  it('скобки вне списка не трогаются', () => {
    const doc = 'просто [ ] текст\n\n';

    expect(shown(doc, doc.length)).toBe(doc);
  });
});

describe('живое превью: знаки вокруг текста', () => {
  it('прячет звёздочки жирного и курсива', () => {
    // Курсор в конце — на другой строке, иначе сработает правило Р-158.
    const doc = '**жирный** и *курсив*\n\n';
    expect(shown(doc, doc.length)).toBe('жирный и курсив\n\n');
  });

  it('прячет зачёркивание, выделение и обратные кавычки', () => {
    const doc = '~~снято~~ ==важно== `код`\n\n';
    expect(shown(doc, doc.length)).toBe('снято важно код\n\n');
  });

  it('строка под курсором показывается исходником (Р-158)', () => {
    const doc = '**первая**\n**вторая**\n';

    // Курсор в начале первой строки: на ней знаки видны, на второй — нет.
    expect(shown(doc, 0)).toBe('**первая**\nвторая\n');
    // Курсор на второй — наоборот.
    expect(shown(doc, doc.indexOf('вторая'))).toBe('первая\n**вторая**\n');
  });

  it('выделение через несколько строк раскрывает их все', () => {
    const doc = '**одна**\n**две**\n**три**\n';
    const editor = EditorState.create({
      doc,
      // До конца второй строки: конец выделения в начале третьей означал бы,
      // что курсор стоит на третьей, и она раскрылась бы тоже.
      selection: EditorSelection.range(0, doc.indexOf('**три**') - 1),
      extensions: markdown({ base: markdownLanguage, codeLanguages: languages }),
    });
    ensureSyntaxTree(editor, editor.doc.length, 5000);

    const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);
    // Спрятаны только знаки третьей строки: первые две задеты выделением.
    let count = 0;
    const iter = set.iter();
    while (iter.value !== null) {
      expect(editor.doc.lineAt(iter.from).number).toBe(3);
      count += 1;
      iter.next();
    }
    expect(count).toBe(2);
  });

  it('выделение, кончающееся в начале строки, раскрывает и её', () => {
    const doc = '**одна**\n**две**\n';
    const editor = EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.indexOf('**две**')),
      extensions: markdown({ base: markdownLanguage, codeLanguages: languages }),
    });
    ensureSyntaxTree(editor, editor.doc.length, 5000);

    // Курсор рисуется в начале второй строки, значит он на ней стоит,
    // и по правилу Р-158 строка показывается исходником.
    expect(decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]).size).toBe(0);
  });

  it('ограждение блока кода не трогается: там разметка и есть содержимое', () => {
    const doc = '```rust\nlet x = 1;\n```\n\nа тут `код`\n';
    // Прячутся только кавычки строчного кода — две, по одной с каждой стороны.
    expect(hiddenParts(doc, 0)).toEqual(['`', '`']);
  });

  it('знаки списка остаются: списки в превью не входят', () => {
    const doc = '- пункт с **жирным**\n1. второй\n';
    expect(hiddenParts(doc, doc.length)).toEqual(['**', '**']);
  });

  it('вложенная разметка прячется целиком и по порядку', () => {
    const doc = '==**оба**==\n\n';
    expect(hiddenParts(doc, doc.length)).toEqual(['==', '**', '**', '==']);
    expect(shown(doc, doc.length)).toBe('оба\n\n');
  });

  it('обычный текст не трогается вовсе', () => {
    const doc = 'просто строка без разметки\n';
    expect(hiddenParts(doc, doc.length)).toEqual([]);
  });

  it('решётка заголовка прячется вместе с пробелом за ней', () => {
    const doc = '# Заголовок\n\n## Второй\n';
    // Пробел уходит со знаком: иначе текст заголовка съехал бы вправо.
    expect(shown(doc, doc.length)).toBe('Заголовок\n\nВторой\n');
  });

  it('угловая скобка цитаты прячется, черту рисует украшение строки', () => {
    const doc = '> цитата\n> вторая\n\n';
    expect(shown(doc, doc.length)).toBe('цитата\nвторая\n\n');
  });

  it('вложенная цитата теряет обе скобки', () => {
    const doc = '>> глубоко\n\n';
    expect(shown(doc, doc.length)).toBe('глубоко\n\n');
  });

  it('ссылка показывается своим текстом', () => {
    const doc = 'см. [текст](https://example.org/путь) дальше\n\n';
    expect(shown(doc, doc.length)).toBe('см. текст дальше\n\n');
  });

  /**
   * Задача 72 отменяет правило этапа 9 «картинка не трогается»: вся запись
   * заменяется рисунком целиком, а не по знакам (Р-184).
   */
  it('картинка заменяется целиком, а не по знакам', () => {
    const doc = '![подпись](файл.png)\n\n';
    expect(hiddenParts(doc, doc.length)).toEqual(['![подпись](файл.png)']);
  });

  it('курсор на строке возвращает всю запись картинки', () => {
    const doc = '![подпись](файл.png)\n\n';
    expect(hiddenParts(doc, 5)).toEqual([]);
  });

  /**
   * Сетевой адрес не загружается никогда (Р-202): приложение открывает
   * соединение только по нажатию, а открытая заметка — не нажатие.
   */
  it('сетевая картинка остаётся исходником', () => {
    const doc = '![снимок](https://example.org/рисунок.png)\n\n';
    expect(hiddenParts(doc, doc.length)).toEqual([]);
  });

  /** Буква диска — не схема адреса: `C:` показывать надо. */
  it('картинка по полному пути Windows показывается', () => {
    const doc = '![снимок](C:/снимки/экран.png)\n\n';
    expect(hiddenParts(doc, doc.length)).toEqual(['![снимок](C:/снимки/экран.png)']);
  });

  /**
   * Таблицу этот плагин не трогает: замена через границу строк меняет
   * высоту документа, и такие украшения CodeMirror принимает только
   * от поля состояния. Её показ проверяется в `tables.test.ts`.
   */
  it('таблицу плагин не трогает', () => {
    const doc = '| Что | Сколько |\n| --- | --- |\n| **Яблоки** | 5 |\n\n';
    expect(hiddenParts(doc, doc.length)).toEqual([]);
  });

  it('вики-ссылка теряет обе пары скобок', () => {
    const doc = 'см. [[Заметка]] дальше\n\n';
    expect(shown(doc, doc.length)).toBe('см. Заметка дальше\n\n');
  });

  it('вики-ссылка с подписью показывается подписью', () => {
    const doc = 'см. [[Планы работ|планы]] дальше\n\n';
    expect(shown(doc, doc.length)).toBe('см. планы дальше\n\n');
  });

  it('раздел в вики-ссылке остаётся: он часть того, куда ведёт ссылка', () => {
    const doc = 'см. [[Заметка#Раздел]]\n\n';
    expect(shown(doc, doc.length)).toBe('см. Заметка#Раздел\n\n');
  });

  it('горизонтальная черта рисуется чертой, а дефисы прячутся', () => {
    const doc = 'до\n\n---\n\nпосле\n';
    expect(shown(doc, 0)).toBe('до\n\n\n\nпосле\n');

    const editor = state(doc, 0);
    const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);
    const classes: string[] = [];
    const iter = set.iter();
    while (iter.value !== null) {
      const spec = iter.value.spec as { class?: string };
      if (typeof spec.class === 'string') classes.push(spec.class);
      iter.next();
    }
    expect(classes).toEqual(['zn-hr']);
  });

  it('подчёркнутый заголовок не трогается: под чертой осталась бы пустота', () => {
    const doc = 'Заголовок\n=========\n\n';
    expect(hiddenParts(doc, doc.length)).toEqual([]);
  });

  it('строка под курсором показывает и блочную разметку', () => {
    const doc = '# Заголовок\n> цитата\n';

    expect(shown(doc, 0)).toBe('# Заголовок\nцитата\n');
    expect(shown(doc, doc.indexOf('цитата'))).toBe('Заголовок\n> цитата\n');
  });

  it('callout получает карточку на все свои строки', () => {
    const doc = '> [!tip] Совет\n> вторая строка\n\nпосле\n';
    const editor = state(doc, doc.length);
    const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);

    const lines = new Map<number, string>();
    const iter = set.iter();
    while (iter.value !== null) {
      const spec = iter.value.spec as { class?: string };
      if (typeof spec.class === 'string' && spec.class.startsWith('zn-callout ')) {
        lines.set(editor.doc.lineAt(iter.from).number, spec.class);
      }
      iter.next();
    }

    expect(lines.get(1)).toContain('zn-callout-tip');
    expect(lines.get(1)).toContain('zn-callout-first');
    expect(lines.get(2)).toContain('zn-callout-last');
    // Пустая строка за цитатой в карточку не входит.
    expect(lines.has(3)).toBe(false);
  });

  it('знак callout-а заменяется значком, а заголовок остаётся текстом', () => {
    const doc = '> [!warning] Осторожно\n> текст\n\n';
    const editor = state(doc, doc.length);
    const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);

    let widget = false;
    let title = '';
    const iter = set.iter();
    while (iter.value !== null) {
      const spec = iter.value.spec as { widget?: unknown; class?: string };
      if (spec.widget) {
        widget = true;
        expect(editor.doc.sliceString(iter.from, iter.to)).toBe('[!warning] ');
      }
      if (spec.class === 'zn-callout-title') {
        title = editor.doc.sliceString(iter.from, iter.to);
      }
      iter.next();
    }

    expect(widget).toBe(true);
    expect(title).toBe('Осторожно');
  });

  it('курсор на первой строке возвращает знак, но карточку не убирает', () => {
    const doc = '> [!tip] Совет\n> текст\n\n';
    const editor = state(doc, 0);
    const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);

    let widget = false;
    let card = false;
    const iter = set.iter();
    while (iter.value !== null) {
      const spec = iter.value.spec as { widget?: unknown; class?: string };
      if (spec.widget) widget = true;
      if (typeof spec.class === 'string' && spec.class.startsWith('zn-callout ')) card = true;
      iter.next();
    }

    // Знак виден исходником (Р-158), карточка на месте — она оформление
    // строки, как черта у цитаты.
    expect(widget).toBe(false);
    expect(card).toBe(true);
  });

  it('обычная цитата карточки не получает', () => {
    const doc = '> просто цитата\n\n';
    const editor = state(doc, doc.length);
    const set = decorateLivePreview(editor, [{ from: 0, to: editor.doc.length }]);

    const iter = set.iter();
    while (iter.value !== null) {
      const spec = iter.value.spec as { class?: string };
      expect(spec.class ?? '').not.toContain('zn-callout');
      iter.next();
    }
  });

  it('превью включается только для markdown', () => {
    expect(livePreviewOn({ livePreview: true, markdown: true })).toBe(true);
    expect(livePreviewOn({ livePreview: true, markdown: false })).toBe(false);
    expect(livePreviewOn({ livePreview: false, markdown: true })).toBe(false);
  });
});
