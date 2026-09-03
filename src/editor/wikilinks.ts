import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { RangeSetBuilder, StateEffect } from '@codemirror/state';

import { resolveLinks } from '../ipc/index';

/**
 * Ссылки и теги в тексте: подсветка и переход.
 *
 * Разбор здесь свой, а не из индекса, и это не дублирование: индекс отвечает
 * на вопрос «кто на кого ссылается» по всему проекту, а редактору нужно знать,
 * что находится под курсором прямо сейчас, — включая только что набранное
 * и ещё не сохранённое.
 *
 * Обходятся только видимые строки: документ может быть на десять мегабайт,
 * а на экране всегда полсотни строк.
 *
 * Переход — Ctrl+щелчок (решение Р-070). Простой щелчок оставлен установке
 * курсора: режима просмотра у нас нет, текст всегда редактируется, и увести
 * пользователя в другой файл при попытке поставить курсор — худшее, что можно
 * сделать.
 */

/** Что нашлось под курсором или под указателем. */
export interface Target {
  kind: 'link' | 'tag';
  /** Для ссылки — цель без раздела и подписи; для тега — имя без решётки. */
  value: string;
  from: number;
  to: number;
}

const LINK = /\[\[([^\]\n]+)\]\]/g;
/**
 * Тег: решётка, за ней буква, дальше буквы, цифры, дефис, подчёркивание,
 * косая черта. Перед решёткой — начало строки или знак, не входящий в слово,
 * иначе `C#` и якорь `файл.md#раздел` стали бы тегами.
 *
 * Правила те же, что в ядре (`markdown/links.rs`); держать их одинаковыми
 * приходится глазами — язык здесь другой.
 */
const TAG = /(^|[^\p{L}\p{N}_/#-])#([\p{L}_][\p{L}\p{N}_/-]*)/gu;

const linkMark = Decoration.mark({ class: 'zn-wikilink' });
const danglingMark = Decoration.mark({
  class: 'zn-wikilink zn-wikilink-dangling',
  attributes: {
    title: 'Заметки с таким именем нет. Ctrl+щелчок создаст её рядом с этой.',
  },
});
const tagMark = Decoration.mark({ class: 'zn-tag' });

/**
 * Что из спрошенного оказалось висячим.
 *
 * Ключ — «откуда|цель»: одна и та же цель из разных файлов может вести
 * в разные заметки, потому что побеждает ближайшая. Знание общее на всё окно:
 * заметки открываются и закрываются, а ответы про них одни и те же.
 */
const resolved = new Map<string, boolean>();

/** Пустое изменение, которым плагин просит перерисоваться после ответа ядра. */
const refresh = StateEffect.define<null>();

function cacheKey(from: string, target: string): string {
  return `${from.toLowerCase()}|${target.toLowerCase()}`;
}

/** Забыть ответы: индекс изменился, и висячая ссылка могла стать рабочей. */
export function forgetResolved(): void {
  resolved.clear();
}

/** Разобрать цель ссылки: убрать раздел и подпись. */
export function linkTarget(inner: string): string {
  const withoutAlias = inner.split('|')[0] ?? inner;
  const withoutHeading = withoutAlias.split('#')[0] ?? withoutAlias;
  return withoutHeading.trim();
}

function decorate(view: EditorView, source: string | null, unknown: Set<string>): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);

    // Собираем в один список и сортируем: RangeSetBuilder требует порядка
    // по возрастанию, а два прохода дают его вперемешку.
    const found: { from: number; to: number; mark: Decoration }[] = [];

    LINK.lastIndex = 0;
    for (let m = LINK.exec(text); m !== null; m = LINK.exec(text)) {
      const target = linkTarget(m[1] ?? '');
      let mark = linkMark;

      if (source !== null && target !== '') {
        const known = resolved.get(cacheKey(source, target));
        if (known === false) {
          mark = danglingMark;
        } else if (known === undefined) {
          // Ответа ещё нет. До него ссылка выглядит обычной: помечать
          // висячей то, чего мы не проверяли, значит врать.
          unknown.add(target);
        }
      }

      found.push({ from: from + m.index, to: from + m.index + m[0].length, mark });
    }

    TAG.lastIndex = 0;
    for (let m = TAG.exec(text); m !== null; m = TAG.exec(text)) {
      const start = m.index + (m[1]?.length ?? 0);
      found.push({ from: from + start, to: from + start + 1 + (m[2]?.length ?? 0), mark: tagMark });
    }

    found.sort((a, b) => a.from - b.from);
    let last = -1;
    for (const item of found) {
      // Пересечения отбрасываем: тег внутри ссылки — это раздел, а не тег.
      if (item.from < last) continue;
      builder.add(item.from, item.to, item.mark);
      last = item.to;
    }
  }

  return builder.finish();
}

/** Что находится в этом месте документа. */
export function targetAt(view: EditorView, pos: number): Target | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const offset = pos - line.from;

  LINK.lastIndex = 0;
  for (let m = LINK.exec(text); m !== null; m = LINK.exec(text)) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      const value = linkTarget(m[1] ?? '');
      if (value === '') return null;
      return {
        kind: 'link',
        value,
        from: line.from + m.index,
        to: line.from + m.index + m[0].length,
      };
    }
  }

  TAG.lastIndex = 0;
  for (let m = TAG.exec(text); m !== null; m = TAG.exec(text)) {
    const start = m.index + (m[1]?.length ?? 0);
    const end = start + 1 + (m[2]?.length ?? 0);
    if (offset >= start && offset <= end) {
      return { kind: 'tag', value: m[2] ?? '', from: line.from + start, to: line.from + end };
    }
  }

  return null;
}

/**
 * Подсветка ссылок и тегов плюс переход по Ctrl+щелчку.
 *
 * `follow` вызывается с тем, что оказалось под указателем. Само действие
 * живёт во фронтенде выше: редактор не должен знать про вкладки и панели.
 */
export function wikilinks(follow: (target: Target) => void, sourcePath: () => string | null) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      /** Идёт запрос к ядру: второй такой же затевать незачем. */
      private asking = false;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: {
        docChanged: boolean;
        viewportChanged: boolean;
        transactions: readonly { effects: readonly StateEffect<unknown>[] }[];
        view: EditorView;
      }) {
        const asked = update.transactions.some((t) =>
          t.effects.some((e) => e.is(refresh)),
        );
        if (update.docChanged || update.viewportChanged || asked) {
          this.decorations = this.build(update.view);
        }
      }

      /**
       * Разметить видимое и, если про какие-то ссылки мы ещё не знаем,
       * спросить ядро — а потом перерисоваться.
       */
      private build(view: EditorView): DecorationSet {
        const source = sourcePath();
        const unknown = new Set<string>();
        const decorations = decorate(view, source, unknown);

        if (source !== null && unknown.size > 0 && !this.asking) {
          this.asking = true;
          const targets = [...unknown];

          void resolveLinks(targets, source)
            .then((answers) => {
              targets.forEach((target, i) => {
                resolved.set(cacheKey(source, target), answers[i] ?? true);
              });
              // Пустое изменение с признаком: перерисоваться прямо из update
              // нельзя — представление в этот момент занято собой.
              view.dispatch({ effects: refresh.of(null) });
            })
            .catch(() => {
              // Индекс мог быть недоступен. Ссылки останутся обычными —
              // это честнее, чем пометить висячими всё подряд.
            })
            .finally(() => {
              this.asking = false;
            });
        }

        return decorations;
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      eventHandlers: {
        mousedown(event: MouseEvent, view: EditorView) {
          if (!event.ctrlKey) return false;

          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return false;

          const target = targetAt(view, pos);
          if (!target) return false;

          // Иначе редактор поставит курсор и начнёт выделение — а мы уже
          // уходим в другой файл.
          event.preventDefault();
          follow(target);
          return true;
        },
      },
    },
  );
}
