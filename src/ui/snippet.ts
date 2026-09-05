import { MARK_START, MARK_END } from '../ipc/index';

/**
 * Отрывок результата поиска: разбор пометок и обрезка ведущего контекста.
 *
 * Отрывок приходит из FTS5 — двенадцать слов вокруг совпадения, помеченного
 * управляющими знаками. Само совпадение в этой строке есть всегда, но стоять
 * оно может где угодно, в том числе в конце: тогда в узкой панели видно
 * только то, что **перед** ним, а найденное слово уезжает за правый край.
 * Так и нашла приёмка этапа 8.
 *
 * Лечится не поиском, а обрезкой: ведущий контекст ограничивается сверху,
 * и совпадение оказывается в начале строки.
 */

/** Кусок отрывка: обычный текст или найденное. */
export type SnippetPiece = { text: string; hit: boolean };

/**
 * Сколько знаков контекста оставлять перед первым совпадением.
 *
 * Считается в знаках, потому что отрывок рисуется шрифтом редактора —
 * моноширинным, — и знак там равен знаку по ширине. Панель по умолчанию
 * 240 px, минус поля строки (12 px с каждой стороны) — 216 px; при кегле
 * 11 px это около 32 знаков, а на наименьшей ширине панели (160 px) —
 * около двадцати. Десять знаков ведущего контекста оставляют совпадение
 * видимым даже там.
 *
 * Ширину панели не измеряем: она тянется мышью, и отрывок, меняющий
 * обрезку при перетаскивании края, читать невозможно.
 */
export const LEAD = 10;

const ELLIPSIS = '…';

/** Разрезать отрывок по пометкам. */
function split(snippet: string): SnippetPiece[] {
  const out: SnippetPiece[] = [];

  for (const chunk of snippet.split(MARK_START)) {
    const [hit, ...rest] = chunk.split(MARK_END);
    if (rest.length === 0) {
      // До первой пометки — обычный текст.
      if (hit !== '') out.push({ text: hit!, hit: false });
      continue;
    }
    if (hit !== '') out.push({ text: hit!, hit: true });
    const tail = rest.join(MARK_END);
    if (tail !== '') out.push({ text: tail, hit: false });
  }
  return out;
}

/**
 * Обрезать ведущий контекст до `lead` знаков, начиная с границы слова.
 *
 * Многоточие ставится своё: то, что поставил FTS5 в начале отрывка, уезжает
 * вместе с обрезанным куском, и двух многоточий подряд не бывает.
 */
function trimLead(text: string, lead: number): string {
  const tail = text.slice(text.length - lead);
  const space = tail.search(/\s/);

  // Половина слова в начале строки читается как опечатка. Но если пробела
  // нет вовсе — строка без пробелов бывает длиной в файл, — режем по месту:
  // лучше половина слова, чем невидимое совпадение.
  const cut = space >= 0 && space + 1 < tail.length ? tail.slice(space + 1) : tail;
  return ELLIPSIS + cut;
}

/**
 * Отрывок кусками, готовыми к отрисовке.
 *
 * Совпадение начинается не позже `lead` знаков от начала строки. Отрывок
 * без пометок — например, подставленный `#тег` — не трогается вовсе:
 * обрезать там нечего, а многоточие в начале соврало бы.
 */
export function snippetPieces(snippet: string, lead: number = LEAD): SnippetPiece[] {
  const pieces = split(snippet);

  const first = pieces[0];
  if (!first || first.hit) return pieces;
  if (!pieces.some((piece) => piece.hit)) return pieces;
  if (first.text.length <= lead) return pieces;

  return [{ text: trimLead(first.text, lead), hit: false }, ...pieces.slice(1)];
}
