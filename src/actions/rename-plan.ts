import type { FileEdits } from '../ipc/tree';
import { plural } from '../ui/plural';

/**
 * Что показать человеку до правки чужих файлов (Р-136).
 *
 * Отдельным модулем и без обращения к состоянию — ради проверяемости.
 * Это тот текст, по которому принимается решение «менять чужие файлы или
 * нет», и ошибка в нём — не опечатка, а неверно поставленный вопрос.
 */

/**
 * Куда переедет путь после переименования `from` → `to`.
 *
 * `null` — этот путь переименование не задевает.
 *
 * Нужно в двух местах, и второе неочевидно. Планы приходят из ядра с путями
 * **после** переименования, а пути открытых вкладок к этому моменту ещё
 * старые. Сравнивать их напрямую нельзя: вкладка внутри переименовываемой
 * папки не совпала бы ни с чем, и файл с несохранёнными правками уехал бы
 * в правку вопреки Р-138.
 */
export function movedPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  // Именно с разделителем: папка `работа` не должна ловить `работа-старое`.
  if (path.startsWith(`${from}\\`)) return to + path.slice(from.length);
  return null;
}

/** План, разложенный на то, что правится, и то, что не будет тронуто. */
export interface SplitPlan {
  editable: FileEdits[];
  /** Открыты с несохранёнными правками — на диске не трогаются (Р-138). */
  blocked: FileEdits[];
}

/**
 * Отделить файлы, которые нельзя править на диске.
 *
 * `busy` — пути вкладок с несохранёнными правками. Сравнение по нижнему
 * регистру: Windows не различает регистр путей, а путь вкладки и путь из
 * плана приходят разными дорогами.
 */
export function splitPlan(files: FileEdits[], busy: Iterable<string>): SplitPlan {
  const taken = new Set([...busy].map((path) => path.toLowerCase()));

  return {
    editable: files.filter((file) => !taken.has(file.path.toLowerCase())),
    blocked: files.filter((file) => taken.has(file.path.toLowerCase())),
  };
}

function links(count: number): string {
  return `${count} ${plural(count, 'ссылка', 'ссылки', 'ссылок')}`;
}

function list(files: FileEdits[]): string {
  // Без отступа: диалог показывает текст с переносами, но начальные пробелы
  // схлопывает, и отступ в исходнике был бы обещанием, которого не видно.
  return files.map((file) => `${file.inside} — ${file.edits.length}`).join('\n');
}

/**
 * Текст вопроса перед переименованием.
 *
 * Список файлов показывается целиком, а не первыми несколькими: это
 * единственное место, где человек может увидеть, во что он ввязывается,
 * и «и ещё 12 файлов» отвечает на вопрос ровно наоборот. Длинный список
 * прокручивается — диалог это умеет.
 */
export function describePlan(name: string, plan: SplitPlan): string {
  const total = [...plan.editable, ...plan.blocked].reduce(
    (sum, file) => sum + file.edits.length,
    0,
  );

  const parts = [
    `На «${name}» ссылаются другие заметки: ${links(total)} ` +
      `в ${plan.editable.length + plan.blocked.length} ` +
      `${plural(plan.editable.length + plan.blocked.length, 'файле', 'файлах', 'файлах')}.`,
  ];

  if (plan.editable.length > 0) {
    parts.push(`Будут исправлены:\n${list(plan.editable)}`);
  }

  if (plan.blocked.length > 0) {
    // Названо причиной, а не запретом: пользователь должен понять, что
    // делать дальше, — сохранить эти вкладки и повторить.
    parts.push(
      'Не будут тронуты, потому что открыты с несохранёнными правками:\n' +
        `${list(plan.blocked)}`,
    );
  }

  return parts.join('\n\n');
}
