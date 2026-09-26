import { EditorState, RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import { GutterMarker, ViewPlugin, gutterLineClass, type EditorView } from '@codemirror/view';
import {
  foldEffect,
  foldGutter,
  foldable,
  foldedRanges,
  unfoldEffect,
} from '@codemirror/language';
import { icon } from '../icons/registry';

/**
 * Свёртка блоков.
 *
 * Что сворачивается — знает язык, а не мы: разбор уже строит дерево, и в нём
 * у каждого узла отмечено, можно ли его свернуть. Поэтому здесь нет ни одного
 * правила вида «фигурная скобка открывает блок»: такое правило пришлось бы
 * писать заново на каждый язык и всё равно врать на строках и комментариях.
 *
 * Заголовки markdown сворачиваются до следующего заголовка того же уровня —
 * это тоже приехало вместе с разбором. Проверено тестом, а не на слово:
 * `tests/folding.test.ts`.
 *
 * Чего это не покрывает: языки из `legacy-modes` (TOML, YAML, INI, SQL, Shell,
 * PowerShell, Lua). Разбор там построчный, дерева нет, и сворачивать нечего.
 * Свёртка по отступам — в «Отложено».
 */

/**
 * Названия на русском.
 *
 * CodeMirror пропускает свои подписи через `state.phrase`, и без словаря
 * пользователь увидел бы «unfold» во всплывающей подсказке посреди русского
 * интерфейса. Ключи — английские строки из исходников библиотеки.
 */
const PHRASES = EditorState.phrases.of({
  'Fold line': 'Свернуть блок',
  'Unfold line': 'Развернуть блок',
  unfold: 'Развернуть',
  'folded code': 'свёрнутый блок',
  'Folded lines': 'Свёрнуты строки',
  'Unfolded lines': 'Развёрнуты строки',
  to: 'по',
});

/**
 * Значок в поле свёртки.
 *
 * Тот же уголок, что у папки в дереве, и повёрнут по тому же правилу:
 * вбок — свёрнуто, вниз — раскрыто. Разметка берётся из своего реестра
 * (`icons/`), поэтому `innerHTML` здесь безопасен — ровно как `{@html}`
 * в `ui/Icon.svelte`.
 */
function markerDOM(open: boolean): HTMLElement {
  const span = document.createElement('span');
  span.className = open ? 'zn-fold zn-fold-open' : 'zn-fold';
  span.innerHTML = icon('tree.chevron');
  return span;
}

/**
 * Строка под указателем мыши — чтобы показать её стрелку свёртки
 * (задача 121).
 *
 * Стрелка у каждого заголовка, пункта и блока, видная всегда, — шум:
 * владелец назвал это первым, сравнивая с Obsidian. Там стрелка
 * появляется, только когда указатель над строкой, и остаётся у свёрнутого
 * блока — иначе свёрнутое не найти.
 *
 * **Почему не `:hover` в CSS.** Поле свёртки — отдельная колонка, а не
 * часть строки: указатель над текстом строки над её клеткой поля
 * не стоит, и правило «строка под указателем — её стрелка» селектором
 * не выразить. Поэтому номер строки знает состояние, а клетке поля класс
 * ставит `gutterLineClass` — тем же путём, каким CodeMirror помечает поле
 * строки курсора.
 *
 * В поле хранится начало строки, а не номер: номер уезжает от правки
 * выше, а позиция переносится вместе с текстом (`mapPos`).
 */
const hoverLine = StateEffect.define<number | null>();

export const hoveredLine = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let next = value === null || !tr.docChanged ? value : tr.changes.mapPos(value);
    for (const effect of tr.effects) {
      if (effect.is(hoverLine)) next = effect.value;
    }
    return next;
  },
});

/** Эффект «указатель над строкой, начинающейся здесь»; `null` — ни над какой. */
export function hoverLineEffect(at: number | null): StateEffect<number | null> {
  return hoverLine.of(at);
}

/** Пометка клетки поля. Своего рисунка нет — только класс. */
class HoverMarker extends GutterMarker {
  override elementClass = 'zn-hover-line';
}

const hoverMarker = new HoverMarker();

/** Клетки поля строки под указателем получают класс `zn-hover-line`. */
export const hoverLineClass = gutterLineClass.compute([hoveredLine], (state) => {
  const at = state.field(hoveredLine);
  if (at === null || at > state.doc.length) return RangeSet.empty;
  return RangeSet.of([hoverMarker.range(state.doc.lineAt(at).from)]);
});

/**
 * Следит за указателем над всем редактором — полем и текстом.
 *
 * Обработчики вешаются на `view.dom`, а не через `eventHandlers` плагина:
 * те ставятся на область текста, и указатель над самой стрелкой (она
 * в поле, левее текста) их бы не будил.
 *
 * Прокрутка колесом двигает текст под неподвижным указателем, событий
 * мыши при этом нет — поэтому строка пересчитывается и на прокрутку,
 * по последнему известному положению.
 *
 * Состояние меняется только когда строка сменилась: движение внутри
 * одной строки транзакций не порождает.
 */
const hoverTracker = ViewPlugin.fromClass(
  class {
    private y: number | null = null;
    private readonly move = (event: MouseEvent): void => {
      this.y = event.clientY;
      this.sync();
    };
    private readonly leave = (): void => {
      this.y = null;
      this.sync();
    };
    private readonly scroll = (): void => {
      if (this.y !== null) this.sync();
    };

    constructor(readonly view: EditorView) {
      view.dom.addEventListener('mousemove', this.move);
      view.dom.addEventListener('mouseleave', this.leave);
      view.scrollDOM.addEventListener('scroll', this.scroll, { passive: true });
    }

    private lineAtPointer(): number | null {
      if (this.y === null) return null;
      const height = this.y - this.view.documentTop;
      const block = this.view.lineBlockAtHeight(height);
      // Под последней строкой пусто: `lineBlockAtHeight` отдаёт ближайший
      // блок, и стрелка последней строки загоралась бы от указателя
      // в пустоте под текстом.
      if (height < block.top || height > block.bottom) return null;
      return block.from;
    }

    private sync(): void {
      const next = this.lineAtPointer();
      if (next === this.view.state.field(hoveredLine)) return;
      this.view.dispatch({ effects: hoverLine.of(next) });
    }

    destroy(): void {
      this.view.dom.removeEventListener('mousemove', this.move);
      this.view.dom.removeEventListener('mouseleave', this.leave);
      this.view.scrollDOM.removeEventListener('scroll', this.scroll);
    }
  },
);

export function folding(): Extension {
  // `foldGutter` тянет за собой и саму свёртку (`codeFolding`), поэтому
  // отдельно её включать не надо.
  return [foldGutter({ markerDOM }), PHRASES, hoveredLine, hoverLineClass, hoverTracker];
}

/** Диапазон, который свернётся, если сворачивать на строке курсора. */
function foldableAtCursor(state: EditorState): { from: number; to: number } | null {
  const line = state.doc.lineAt(state.selection.main.head);
  return foldable(state, line.from, line.to);
}

/** Свёртка, начинающаяся на строке курсора, если она там есть. */
function foldAtCursor(state: EditorState): { from: number; to: number } | null {
  const line = state.doc.lineAt(state.selection.main.head);

  // Через массив, а не через переменную-накопитель: обход внутри замыкания
  // сбивает вывод типов, и результат оказывается `null` по мнению компилятора.
  const found: { from: number; to: number }[] = [];
  foldedRanges(state).between(line.from, line.to, (from, to) => {
    found.push({ from, to });
    return false;
  });
  return found[0] ?? null;
}

/**
 * Команды работают со строкой курсора, а не со всем выделением.
 *
 * У CodeMirror свои команды обходят все выделенные строки. Нам это не годится
 * по двум причинам сразу. Во-первых, пункт меню обязан быть доступен ровно
 * тогда, когда он сработает, — а для этого надо знать заранее, есть ли что
 * сворачивать. Во-вторых, «выделить всё» в файле на миллион строк превратило
 * бы такую проверку в обход миллиона строк на каждое открытие меню.
 *
 * «Свернуть блок под курсором» — договорённость понятная и совпадающая
 * с подписью пункта.
 */
export function canFold(state: EditorState): boolean {
  return foldableAtCursor(state) !== null;
}

export function canUnfold(state: EditorState): boolean {
  return foldAtCursor(state) !== null;
}

export function foldBlock(view: EditorView): boolean {
  const range = foldableAtCursor(view.state);
  if (!range) return false;
  view.dispatch({ effects: foldEffect.of(range) });
  return true;
}

export function unfoldBlock(view: EditorView): boolean {
  const range = foldAtCursor(view.state);
  if (!range) return false;
  view.dispatch({ effects: unfoldEffect.of(range) });
  return true;
}
