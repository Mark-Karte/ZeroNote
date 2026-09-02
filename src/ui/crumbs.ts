/**
 * Хлебные крошки пути в шапке окна.
 *
 * Логика отделена от разметки, потому что здесь есть что проверять: разбор
 * пути, поиск корня, поведение на файле вне корней и на буфере без файла.
 * Разметка вокруг неё проверяется глазами, а это — тестом.
 */

export interface Crumb {
  /** Что показывать. */
  text: string;
  /** `true` — последняя крошка, то есть сам файл: она печатается ярче. */
  leaf: boolean;
}

/** Корень в том виде, в каком он нужен крошкам. */
export interface CrumbRoot {
  path: string;
  name: string;
}

/**
 * Разбить путь на части, не потеряв корень диска.
 *
 * Windows-путь приходит с обратными косыми, но в переносимом файле проекта
 * или в аргументе командной строки могут оказаться и прямые. Считаем
 * разделителем и то, и другое.
 */
function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter((part) => part.length > 0);
}

/**
 * Путь для сравнения: разделители к одному виду, регистр к нижнему.
 *
 * Windows не различает регистр в путях, и корень `C:\Проект` обязан узнать
 * свой файл, записанный в сессии как `c:\проект\файл.md`. Кириллицу
 * `toLowerCase` в JavaScript приводит правильно — в отличие от `lower()`
 * в SQLite, из-за которого пришлось заводить отдельную колонку в индексе.
 */
function key(path: string): string {
  return path.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Лежит ли файл внутри корня. Сравнение по границе части пути. */
function inside(rootKey: string, fileKey: string): boolean {
  return fileKey === rootKey || fileKey.startsWith(`${rootKey}/`);
}

/**
 * Крошки для активного буфера.
 *
 * Три случая:
 *
 * 1. Файл в одном из корней — показываем имя корня и путь от него.
 *    Корень выбирается самый глубокий: вложенные корни разрешены, и файл
 *    ближнего из них принадлежит именно ему.
 * 2. Файл вне корней — показываем многоточие и две последние части пути.
 *    Полный путь в шапку не помещается, а начало его всё равно неинтересно.
 * 3. Буфера нет или он не привязан к файлу — крошек нет вовсе. Заголовок
 *    «Без имени 1» уже написан на вкладке, повторять его незачем.
 */
export function crumbsFor(
  path: string | null,
  roots: readonly CrumbRoot[],
): Crumb[] {
  if (path === null) return [];

  const fileKey = key(path);
  const parts = segments(path);
  if (parts.length === 0) return [];

  const fileName = parts[parts.length - 1]!;

  let best: { root: CrumbRoot; depth: number } | null = null;
  for (const root of roots) {
    const rootKey = key(root.path);
    if (!inside(rootKey, fileKey)) continue;
    const depth = segments(root.path).length;
    if (best === null || depth > best.depth) {
      best = { root, depth };
    }
  }

  if (best !== null) {
    const tail = parts.slice(best.depth);
    return [
      { text: best.root.name, leaf: false },
      ...tail.map((part, index) => ({
        text: part,
        leaf: index === tail.length - 1,
      })),
    ];
  }

  const parent = parts.length >= 2 ? parts[parts.length - 2]! : null;
  const crumbs: Crumb[] = [];
  // Многоточие только если что-то и правда отброшено: у файла в корне диска
  // отбрасывать нечего, и «…» врало бы.
  if (parts.length > 2) crumbs.push({ text: '…', leaf: false });
  if (parent !== null) crumbs.push({ text: parent, leaf: false });
  crumbs.push({ text: fileName, leaf: true });
  return crumbs;
}
