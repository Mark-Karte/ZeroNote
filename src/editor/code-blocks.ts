import { syntaxTree, LanguageDescription } from '@codemirror/language';
import { RangeSetBuilder, type EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

import { icon } from '../icons/registry';
import { DIAGRAM_LANGUAGE } from './diagram';
import { LANGUAGES } from './langs';
import { languages } from './markdown-code';

/**
 * Блоки кода в markdown: подложка, рамка, подпись языка, копирование.
 *
 * Подключается только вместе с markdown (см. `langs.ts`): в файле `.rs` весь
 * текст и так код, и выделять в нём нечего.
 *
 * **Подпись справа, как у Obsidian** (задача 125). В заметке с превью
 * ограждения вне курсора спрятаны (`live-preview.ts`), и подпись — это
 * единственный способ узнать язык блока. Показывает она то, чем мы язык
 * признали: ```c++ подписан «C / C++». Незнакомое имя — как написано,
 * цветом предупреждения и с пояснением: блок не раскрасится, и из самого
 * текста не видно почему. Ограждение без языка — без подписи.
 *
 * Обходятся только видимые строки. Блок может быть длиной в файл, а на экране
 * всегда полсотни строк — инвариант 6 не делает исключения для оформления.
 */

/** Сколько держать отметку об удачном копировании. */
const COPIED_MS = 1200;

const blockLine = Decoration.line({ class: 'zn-code-block' });
const firstLine = Decoration.line({ class: 'zn-code-block zn-code-block-first' });
const lastLine = Decoration.line({ class: 'zn-code-block zn-code-block-last' });
const soleLine = Decoration.line({
  class: 'zn-code-block zn-code-block-first zn-code-block-last',
});

/** Человеческое имя языка по тому, что написано в ограждении. */
export function languageLabel(info: string): string | null {
  const trimmed = info.trim();
  if (trimmed === '') {
    // Ограждение без языка — сообщать не о чем: никто ничего и не обещал.
    return null;
  }

  // Схема (задача 117): раскраски у неё нет, но и «нет подсветки» —
  // неправда: язык узнан, блок рисуется схемой, когда курсор уйдёт.
  if (trimmed.split(/\s+/)[0]!.toLowerCase() === DIAGRAM_LANGUAGE) return 'схема mermaid';

  // Тем же способом, что и сам разбор markdown, иначе подпись рассказывала бы
  // про один язык, а подсветка приезжала бы от другого.
  const match = LanguageDescription.matchLanguageName(languages, trimmed, true);
  if (!match) return null;

  return LANGUAGES.find((lang) => lang.id === match.name)?.label ?? match.name;
}

class HeaderWidget extends WidgetType {
  constructor(
    /** Подпись языка либо `null`, если признать не удалось или нечего. */
    readonly label: string | null,
    /** Что написано в ограждении первым словом; пусто — ничего. */
    readonly named: string,
  ) {
    super();
  }

  /**
   * Текста блока в виджете нет — он читается в момент щелчка
   * (`blockTextAt`), поэтому и сравнивать его не нужно: кнопка всегда
   * копирует то, что в блоке сейчас.
   */
  override eq(other: HeaderWidget): boolean {
    return this.label === other.label && this.named === other.named;
  }

  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement('span');
    host.className = 'zn-code-head';
    // Виджет лежит внутри редактируемой области, и без этого браузер считал бы
    // его текстом: в него можно было бы поставить курсор и набрать букву.
    host.contentEditable = 'false';

    if (this.label !== null) {
      const name = document.createElement('span');
      name.className = 'zn-code-lang';
      name.textContent = this.label;
      host.append(name);
    } else if (this.named !== '') {
      const unknown = document.createElement('span');
      unknown.className = 'zn-code-lang zn-code-lang-unknown';
      unknown.textContent = this.named;
      unknown.title = 'Такого языка нет в наборе — блок останется без цвета';
      host.append(unknown);
    }

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'zn-code-copy';
    copy.title = 'Скопировать содержимое блока';
    copy.setAttribute('aria-label', 'Скопировать содержимое блока');
    copy.innerHTML = icon('action.copy');
    copy.addEventListener('click', (event) => {
      event.preventDefault();
      void this.copyTo(view, host, copy);
    });
    host.append(copy);

    return host;
  }

  private async copyTo(view: EditorView, host: HTMLElement, button: HTMLButtonElement): Promise<void> {
    // Где стоит подпись — у представления: между сборкой и щелчком правки
    // могли сдвинуть блок, а виджет при этом остаться прежним.
    const body = blockTextAt(view.state, view.posAtDOM(host));
    if (body === null) {
      button.classList.add('zn-code-copy-failed');
      button.title = 'Не удалось найти блок под подписью';
      return;
    }

    try {
      await navigator.clipboard.writeText(body);
    } catch {
      // Молчать нельзя: человек нажал и ждёт, что текст в буфере.
      button.classList.add('zn-code-copy-failed');
      button.title = 'Не удалось обратиться к буферу обмена';
      return;
    }

    button.classList.add('zn-code-copied');
    button.innerHTML = icon('action.check');
    button.title = 'Скопировано';
    window.setTimeout(() => {
      // Виджет мог быть пересоздан правкой — тогда этой кнопки уже нет
      // в документе, и возвращать ей вид некому и незачем.
      if (!button.isConnected) return;
      button.classList.remove('zn-code-copied');
      button.innerHTML = icon('action.copy');
      button.title = 'Скопировать содержимое блока';
    }, COPIED_MS);
  }

  /** Нажатие на кнопку — наше дело, редактору его обрабатывать не нужно. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Текст блока для буфера обмена: строки с `from` по `to` без того, что стоит
 * перед ограждением, — `> ` цитаты или отступа пункта. Строка, у которой
 * такого начала нет (пустая `>` в коллауте), теряет то, что от него есть.
 */
export function blockBody(state: EditorState, from: number, to: number, prefix: string): string {
  const out: string[] = [];
  const bare = prefix.trimEnd();
  for (let number = from; number <= to; number += 1) {
    const text = state.doc.line(number).text;
    if (prefix !== '' && text.startsWith(prefix)) out.push(text.slice(prefix.length));
    else if (bare !== '' && text.startsWith(bare)) out.push(text.slice(bare.length));
    else out.push(text);
  }
  return out.join('\n');
}

/**
 * Текст блока кода, на строке открывающего ограждения которого стоит `pos`, —
 * то, что кнопка копирования кладёт в буфер обмена. `null` — блока там нет.
 *
 * Читается в момент щелчка, а не при сборке подписи (Р8 ревизии, задача
 * 145): подпись пересобирается на каждое нажатие, а блок бывает длиной
 * в файл — склеивать его ради кнопки, которую нажмут раз в день, значит
 * обходить файл на каждое нажатие (инвариант 6).
 */
export function blockTextAt(state: EditorState, pos: number): string | null {
  const { doc } = state;
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node !== null && node.name !== 'FencedCode') node = node.parent;
  if (node === null) return null;

  const opening = doc.lineAt(node.from);
  const closing = doc.lineAt(Math.max(node.from, node.to - 1));

  // Закрывающее ограждение может отсутствовать: блок пишут сверху вниз,
  // и половину времени он не дописан. Узнаётся по разбору, а не по
  // виду строки: у блока в цитате или коллауте строка начинается
  // с `> `, и проверка «строка начинается с кавычек» его не видела —
  // закрывающее ограждение уезжало в копируемый текст (найдено
  // сравнением, задача 125).
  const marks = node.getChildren('CodeMark');
  const fenced =
    closing.number > opening.number &&
    marks.length > 1 &&
    doc.lineAt(marks[marks.length - 1]!.from).number === closing.number;
  const bodyFrom = opening.number + 1;
  const bodyTo = fenced ? closing.number - 1 : closing.number;
  if (bodyTo < bodyFrom) return '';

  // Всё, что стоит перед ограждением, — угловые скобки цитаты или
  // отступ пункта — повторяется у каждой строки блока и в буфер
  // обмена не идёт.
  const prefix = marks[0] ? doc.sliceString(opening.from, marks[0].from) : '';
  return blockBody(state, bodyFrom, bodyTo, prefix);
}

/**
 * Разметить блоки кода в заданных отрезках документа.
 *
 * Принимает состояние и отрезки, а не представление, чтобы проверяться тестом
 * без окна: сборка украшений — чистая работа над состоянием, а `toDOM` виджета
 * зовётся уже при отрисовке.
 */
export function decorateBlocks(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = state;
  const tree = syntaxTree(state);

  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'FencedCode') return;

        const opening = doc.lineAt(node.from);
        // Шаг назад обязателен. У дописанного блока `node.to` стоит в конце
        // строки закрывающего ограждения, а у недописанного — в конце
        // документа, то есть уже в начале пустой последней строки. Без
        // поправки подложка у второго уезжала на строку ниже; тест на это
        // и заведён.
        const closing = doc.lineAt(Math.max(node.from, node.to - 1));

        // Подпись и кнопка — на строке открывающего ограждения. Если она
        // уехала за верхний край, показывать нечего: виджет живёт в строке,
        // а не в углу блока. Текст для кнопки здесь не собирается — его
        // читает щелчок (`blockTextAt`).
        if (opening.from >= range.from && opening.from <= range.to) {
          const infoNode = node.node.getChild('CodeInfo');
          const info = infoNode ? doc.sliceString(infoNode.from, infoNode.to) : '';

          builder.add(
            opening.from,
            opening.from,
            opening.number === closing.number ? soleLine : firstLine,
          );
          builder.add(
            opening.to,
            opening.to,
            Decoration.widget({
              widget: new HeaderWidget(languageLabel(info), info.trim().split(/\s+/)[0] ?? ''),
              side: 1,
            }),
          );
        }

        // Только видимая часть блока: он может быть длиной во весь файл.
        const from = Math.max(opening.number + 1, doc.lineAt(range.from).number);
        const to = Math.min(closing.number, doc.lineAt(range.to).number);
        for (let number = from; number <= to; number += 1) {
          const line = doc.line(number);
          builder.add(
            line.from,
            line.from,
            number === closing.number ? lastLine : blockLine,
          );
        }
      },
    });
  }

  return builder.finish();
}

/** Оформление блоков кода. Ставится рядом с разбором markdown. */
export function codeBlocks() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = decorateBlocks(view.state, view.visibleRanges);
      }

      /**
       * Сравнение деревьев обязательно, и причина точная (Р-169, приёмка
       * этапа 9). Язык при установке разбирает синхронно только первые
       * 3000 знаков (`LanguageState.init`), а дальше дерево дорастает
       * фоновой работой — обновлениями, у которых нет ни правки, ни смены
       * видимой области. Первый экран, который длиннее трёх тысяч знаков,
       * оставался бы без украшений до первой правки или прокрутки.
       */
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = decorateBlocks(update.view.state, update.view.visibleRanges);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
