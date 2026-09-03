import { syntaxTree, LanguageDescription } from '@codemirror/language';
import { RangeSetBuilder, type EditorState } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';

import { icon } from '../icons/registry';
import { LANGUAGES } from './langs';
import { languages } from './markdown-code';

/**
 * Блоки кода в markdown: подложка, рамка, подпись языка, копирование.
 *
 * Подключается только вместе с markdown (см. `langs.ts`): в файле `.rs` весь
 * текст и так код, и выделять в нём нечего.
 *
 * **Чем это отличается от того же в Obsidian.** Там блок оформляется в режиме
 * чтения, где ограждение из обратных кавычек спрятано, и подпись языка — это
 * единственный способ узнать, какой он. У нас редактор исходного текста,
 * ограждение видно всегда, и повторять его подписью было бы пустой строкой
 * на экране. Поэтому подпись показывает не то, что написано в ограждении,
 * а то, чем мы это признали: ```c++ подписан «C / C++», а ```jsonc —
 * «нет подсветки». Второе — единственный способ понять, почему блок не
 * раскрасился; из самого текста этого не видно.
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
    /** Было ли в ограждении что-то написано. */
    readonly named: boolean,
    /** Что кладём в буфер обмена по нажатию. */
    readonly body: string,
  ) {
    super();
  }

  override eq(other: HeaderWidget): boolean {
    // Тело сравнивается тоже: иначе кнопка осталась бы с текстом,
    // который был в блоке до правки.
    return (
      this.label === other.label && this.named === other.named && this.body === other.body
    );
  }

  toDOM(): HTMLElement {
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
    } else if (this.named) {
      const unknown = document.createElement('span');
      unknown.className = 'zn-code-lang zn-code-lang-unknown';
      unknown.textContent = 'нет подсветки';
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
      void this.copyTo(copy);
    });
    host.append(copy);

    return host;
  }

  private async copyTo(button: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.body);
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

        // Закрывающее ограждение может отсутствовать: блок пишут сверху вниз,
        // и половину времени он не дописан.
        const fenced =
          closing.number > opening.number && /^\s*(```|~~~)/.test(closing.text);
        const bodyFrom = opening.number + 1;
        const bodyTo = fenced ? closing.number - 1 : closing.number;

        // Подпись и кнопка — на строке открывающего ограждения. Если она
        // уехала за верхний край, показывать нечего: виджет живёт в строке,
        // а не в углу блока.
        if (opening.from >= range.from && opening.from <= range.to) {
          const info = opening.text.replace(/^\s*(```|~~~)/, '');
          const body =
            bodyTo >= bodyFrom
              ? doc.sliceString(doc.line(bodyFrom).from, doc.line(bodyTo).to)
              : '';

          builder.add(
            opening.from,
            opening.from,
            opening.number === closing.number ? soleLine : firstLine,
          );
          builder.add(
            opening.to,
            opening.to,
            Decoration.widget({
              widget: new HeaderWidget(languageLabel(info), info.trim() !== '', body),
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

      update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = decorateBlocks(update.view.state, update.view.visibleRanges);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
