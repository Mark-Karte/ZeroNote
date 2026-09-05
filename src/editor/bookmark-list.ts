/**
 * Список закладок для панели (задача 59).
 *
 * Чистая сборка отдельно от компонента: что именно попадает в список
 * и в каком порядке — то, что должно проверяться тестом, а не щелчком
 * по одному случаю за раз.
 *
 * Панель показывает закладки **всех открытых вкладок**, а не только текущей
 * (Р-157). Метки у номеров строк с задачи 37 и так показывают закладки
 * открытого файла; ценность списка в том, чего в поле номеров нет, —
 * в тексте строки и в возможности прыгнуть в другой файл, не открывая его
 * заново.
 */

/** Вкладка глазами списка: только то, что ему нужно знать. */
export interface BookmarkSource {
  id: number;
  title: string;
  /** Номера строк с закладками — то же, что уезжает в сессию. */
  lines: number[];
  /** Сколько строк в документе: закладка за концом файла в список не идёт. */
  lineCount: number;
  /** Текст строки по номеру. */
  lineText: (line: number) => string;
}

export interface BookmarkRow {
  tabId: number;
  line: number;
  /** Текст строки без отступа; пустая строка остаётся пустой. */
  text: string;
}

export interface BookmarkGroup {
  tabId: number;
  title: string;
  rows: BookmarkRow[];
}

/**
 * Сколько знаков строки показывать.
 *
 * Строка бывает длиной в мегабайт — минифицированный файл открывают именно
 * в редакторе этого класса (родня Р-101). Обрезаем при сборке, а не стилем:
 * `text-overflow` обрежет на экране, но саму строку в память всё равно
 * скопирует.
 */
const LIMIT = 200;

/**
 * Группы закладок по вкладкам.
 *
 * Порядок групп — порядок вкладок; активная не поднимается наверх. Список,
 * который переставляется при каждом переключении вкладки, читать нельзя:
 * глаз ищет строку там, где видел её в прошлый раз.
 *
 * Вкладки без закладок в список не попадают вовсе — иначе панель у человека
 * с десятью открытыми файлами состояла бы из заголовков.
 */
export function bookmarkGroups(sources: readonly BookmarkSource[]): BookmarkGroup[] {
  const groups: BookmarkGroup[] = [];

  for (const source of sources) {
    const rows: BookmarkRow[] = [];

    // Номера строк приходят от набора закладок по порядку, но набор мог
    // прийти и из сессии, где его правили руками. Порядок и уникальность
    // здесь дешевле, чем разбор жалобы «строки скачут».
    const lines = [...new Set(source.lines)].sort((a, b) => a - b);

    for (const line of lines) {
      if (line < 1 || line > source.lineCount) continue;
      rows.push({
        tabId: source.id,
        line,
        text: source.lineText(line).trim().slice(0, LIMIT),
      });
    }

    if (rows.length > 0) {
      groups.push({ tabId: source.id, title: source.title, rows });
    }
  }

  return groups;
}

/** Сколько всего закладок в списке: для подписи и для пустого состояния. */
export function bookmarkCount(groups: readonly BookmarkGroup[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}
