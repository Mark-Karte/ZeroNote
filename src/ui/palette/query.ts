/**
 * Разбор строки палитры на режим и запрос (Р-076).
 *
 * Одно поле вместо трёх: пустой запрос ищет файлы, `>` переключает на команды,
 * `#` — на теги. Три отдельных поля с тремя сочетаниями пришлось бы запоминать,
 * а одно с префиксами подсказывает само.
 */

export type PaletteMode = 'files' | 'commands' | 'tags';

export interface Parsed {
  mode: PaletteMode;
  /** Что искать. Префикс снят, начальные пробелы тоже. */
  term: string;
}

const PREFIXES: { sign: string; mode: PaletteMode }[] = [
  { sign: '>', mode: 'commands' },
  { sign: '#', mode: 'tags' },
];

export function parse(raw: string): Parsed {
  // Пробелы перед знаком не должны отменять режим: набирая быстро, легко
  // задеть пробел первым.
  const text = raw.replace(/^\s+/, '');

  for (const { sign, mode } of PREFIXES) {
    if (text.startsWith(sign)) {
      return { mode, term: text.slice(sign.length).replace(/^\s+/, '') };
    }
  }

  return { mode: 'files', term: text };
}

/**
 * Переписать строку под нужный режим, сохранив набранное.
 *
 * Нужно точкам входа: `Ctrl+P` обязан открыть палитру на файлах, даже если
 * в прошлый раз в ней остались команды. Иначе привычное сочетание приводило бы
 * то туда, то сюда — в зависимости от того, чем пользовались до этого.
 *
 * Запрос при этом сохраняется: пользователь набрал слово, промахнулся режимом
 * и переключается — заставлять его набирать заново незачем.
 */
export function withMode(raw: string, mode: PaletteMode): string {
  const { term } = parse(raw);
  const sign = PREFIXES.find((p) => p.mode === mode)?.sign ?? '';
  return sign + term;
}

/** Подпись поля для режима — она же объясняет, что префиксы вообще есть. */
export function placeholderFor(mode: PaletteMode): string {
  switch (mode) {
    case 'commands':
      return 'Команда';
    case 'tags':
      return 'Тег';
    default:
      return 'Имя файла, > команда, # тег';
  }
}

/**
 * Совпадение по вхождению: начало и длина куска, либо `null`.
 *
 * Для команд и тегов этого достаточно, и нечёткий поиск здесь был бы лишним:
 * команд три десятка, они на виду, и «фйл» вместо «файл» никто не наберёт.
 * У файлов иначе — их тысячи, и там работает нечёткое совпадение в ядре.
 */
export function matchRange(text: string, term: string): [number, number] | null {
  if (term === '') return null;
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  return at < 0 ? null : [at, term.length];
}

/** Подходит ли строка под запрос. Пустой запрос подходит всему. */
export function matches(text: string, term: string): boolean {
  return term === '' || matchRange(text, term) !== null;
}
