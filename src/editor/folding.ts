import { EditorState, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
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

export function folding(): Extension {
  // `foldGutter` тянет за собой и саму свёртку (`codeFolding`), поэтому
  // отдельно её включать не надо.
  return [foldGutter({ markerDOM }), PHRASES];
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
