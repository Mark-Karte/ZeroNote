import { countColumn, type Extension, type Text } from '@codemirror/state';
import { StreamLanguage, foldService, type LanguageSupport } from '@codemirror/language';

/**
 * Свёртка по отступам (задача 92).
 *
 * Свёртку по разбору сделала задача 33, и правил вида «скобка открывает блок»
 * там нет ни одного: что сворачивается, знает язык. Но у языков
 * из `legacy-modes` — TOML, YAML, INI, SQL, Shell, PowerShell, Lua — разбор
 * построчный, дерева нет вовсе, и сворачивать нечего. То же у обычного текста.
 *
 * Здесь и правда своё правило поверх чужого разбора, и от этого никуда
 * не деться: **строка сворачивается, если следующая непустая написана
 * с большим отступом**. Правило грубое, зато одно на все такие языки,
 * и врать оно может только видом — текста оно не трогает.
 *
 * Границы поставлены сразу, до кода:
 *
 * * **не там, где есть дерево.** Свёртка по отступам ставится только языкам
 *   с построчным разбором и файлам без языка. В markdown, Rust и прочих
 *   сворачивает разбор, и подменять его грубым правилом нельзя;
 * * **пустая строка блок не кончает**, но и в него не входит: блок кончается
 *   на последней непустой строке с большим отступом. Иначе свёртка съедала бы
 *   пустоту между разделами;
 * * **у блока есть предел** (`MAX_BLOCK`). Поле свёртки спрашивает про каждую
 *   видимую строку, а каждый вопрос — это проход вперёд до конца блока;
 *   на файле, где всё вложено в первую строку, без предела это был бы обход
 *   всего файла полсотни раз на каждую отрисовку (инвариант 6).
 */

/**
 * Сколько строк вперёд смотрит правило.
 *
 * Пять тысяч — это заведомо больше любого раздела в настройках или заметке
 * и заведомо меньше, чем стоит обходить на каждой отрисовке. Блок длиннее
 * не сворачивается вовсе: свернуть половину блока значило бы соврать
 * о его границе, а это хуже, чем не сворачивать.
 */
const MAX_BLOCK = 5000;

/**
 * Отступ строки в колонках. `null` — строка пустая.
 *
 * В колонках, а не в знаках: таб шире пробела, и строка с табом вложена
 * в строку с одним пробелом, а не наоборот. Ширина таба берётся у состояния —
 * та же, которой пользуется сам редактор (задача 35).
 */
export function indentOf(text: string, tabSize: number): number | null {
  const body = text.search(/\S/);
  if (body < 0) return null;
  return countColumn(text.slice(0, body), tabSize);
}

/**
 * Что свернётся, если свернуть на этой строке. `null` — нечего.
 *
 * Принимает документ, а не состояние: правило чистое, и проверять его надо
 * на строках, а не в окне.
 */
export function indentFold(
  doc: Text,
  lineNumber: number,
  tabSize: number,
): { from: number; to: number } | null {
  const line = doc.line(lineNumber);
  const base = indentOf(line.text, tabSize);
  if (base === null) return null;

  let last = 0;
  const limit = Math.min(doc.lines, lineNumber + MAX_BLOCK);

  for (let number = lineNumber + 1; number <= limit; number += 1) {
    const indent = indentOf(doc.line(number).text, tabSize);
    // Пустая строка не кончает блок: между пунктами раздела бывает пустота,
    // и обрывать на ней значило бы сворачивать по одному пункту.
    if (indent === null) continue;
    if (indent <= base) break;

    last = number;
    // Блок дошёл до предела и, судя по всему, продолжается: не сворачиваем
    // вовсе. Свернуть половину блока значило бы соврать о его границе.
    if (number === limit && limit < doc.lines) return null;
  }

  if (last === 0) return null;
  return { from: line.to, to: doc.line(last).to };
}

/**
 * Свёртка по отступам для этого языка — или ничего.
 *
 * `support` — то, что приехало в отсек языка: `null` у файла без языка.
 * Язык с настоящим разбором (markdown, Rust, JavaScript) получает пустое
 * расширение: `foldService` спрашивается **раньше** дерева, и грубое правило
 * молча заменило бы собой свёртку по разбору.
 *
 * Построчный язык узнаётся по типу (`StreamLanguage`), а не по списку имён:
 * список пришлось бы дописывать при каждом новом языке из `legacy-modes`,
 * и однажды его забыли бы.
 */
export function indentFolding(support: LanguageSupport | null): Extension {
  const language = support?.language ?? null;
  if (language !== null && !(language instanceof StreamLanguage)) return [];

  return foldService.of((state, lineStart) =>
    indentFold(state.doc, state.doc.lineAt(lineStart).number, state.tabSize),
  );
}
