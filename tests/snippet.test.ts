import { describe, expect, it } from 'vitest';
import { LEAD, snippetPieces } from '../src/ui/snippet';

/**
 * Отрывок результата поиска.
 *
 * Задача 62 родилась из приёмки этапа 8: в панели по умолчанию видно было
 * только то, что стоит перед найденным словом, а само слово уезжало
 * за правый край. Отрывок из FTS5 при этом исправен — совпадение в строке
 * есть всегда, — поэтому проверяется здесь одно: далеко ли оно от начала.
 */

const S = '\u0001';
const E = '\u0002';

/** Сколько знаков стоит перед первым совпадением. */
const offset = (snippet: string): number => {
  const pieces = snippetPieces(snippet);
  let seen = 0;
  for (const piece of pieces) {
    if (piece.hit) return seen;
    seen += piece.text.length;
  }
  return seen;
};

/** Отрывок обратно строкой, без пометок. */
const plain = (snippet: string): string =>
  snippetPieces(snippet)
    .map((piece) => piece.text)
    .join('');

describe('отрывок поиска', () => {
  it('совпадение видно с начала строки, как бы далеко оно ни стояло', () => {
    const long = '…в тот день мы долго спорили о том, как назвать папку, и решили';
    expect(offset(`${long} ${S}метель${E} за окном`)).toBeLessThanOrEqual(LEAD + 1);
  });

  it('короткий контекст не трогается: лишнее многоточие соврало бы', () => {
    const snippet = `утром ${S}метель${E} и ветер`;
    expect(plain(snippet)).toBe('утром метель и ветер');
  });

  it('совпадение в самом начале остаётся в начале', () => {
    const snippet = `${S}метель${E} началась к вечеру`;
    expect(snippetPieces(snippet)[0]).toEqual({ text: 'метель', hit: true });
  });

  it('обрезка идёт по границе слова, а не по половине', () => {
    const snippet = `длинное предисловие про погоду ${S}метель${E}`;
    // Последние десять знаков контекста — «ро погоду »; начинать строку
    // с «ро» нельзя, это читается как опечатка.
    expect(plain(snippet)).toBe('…погоду метель');
  });

  it('строка без пробелов режется по месту: половина слова лучше невидимого совпадения', () => {
    const snippet = `${'я'.repeat(200)}${S}метель${E}`;
    expect(offset(snippet)).toBeLessThanOrEqual(LEAD + 1);
  });

  it('хвост после совпадения остаётся целиком', () => {
    const snippet = `длинное предисловие про погоду ${S}метель${E} и ветер до утра`;
    expect(plain(snippet).endsWith('метель и ветер до утра')).toBe(true);
  });

  it('второе совпадение не трогается', () => {
    const snippet = `длинное предисловие про погоду ${S}метель${E} и ${S}ветер${E}`;
    expect(snippetPieces(snippet).filter((piece) => piece.hit).map((p) => p.text)).toEqual([
      'метель',
      'ветер',
    ]);
  });

  it('многоточие FTS5 не удваивается', () => {
    const snippet = `…длинное предисловие про погоду ${S}метель${E}`;
    expect(plain(snippet)).not.toContain('……');
  });

  it('отрывок без пометок — например, подставленный тег — остаётся как есть', () => {
    expect(snippetPieces('#работа/срочное')).toEqual([
      { text: '#работа/срочное', hit: false },
    ]);
  });

  it('пустой отрывок не даёт кусков', () => {
    expect(snippetPieces('')).toEqual([]);
  });
});
