import type { ReplaceFile, ReplacePlan } from '../ipc/edits';
import type { SplitPlan } from './rename-plan';
import { plural } from '../ui/plural';

/**
 * Что показать человеку до замены по проекту (задача 88).
 *
 * Отдельным модулем и без обращения к состоянию — ради проверяемости, как
 * и текст переименования (Р-136). Это тот текст, по которому принимается
 * решение «менять чужие файлы или нет», и ошибка в нём — не опечатка,
 * а неверно поставленный вопрос.
 *
 * Разница с переименованием одна, и она про доверие. Там правились ссылки,
 * которые приложение само же и построило, и хватало списка файлов. Здесь
 * заменяется произвольный текст, набранный человеком, поэтому кроме списка
 * файлов показываются **строки**: увидеть, что «план» нашёлся ещё
 * и в «планёрке», можно только глазами.
 */

/** Сколько строк показывать. Список, а не весь план: строк бывают тысячи. */
const PREVIEW_LINES = 20;

/** Заголовок вопроса. */
export function replaceTitle(query: string, replacement: string): string {
  // Замена на пустоту — это удаление, и называть её заменой значит просить
  // согласия не на то, что произойдёт.
  return replacement === ''
    ? `Удалить «${query}»?`
    : `Заменить «${query}» на «${replacement}»?`;
}

function matches(count: number): string {
  return `${count} ${plural(count, 'совпадение', 'совпадения', 'совпадений')}`;
}

function files(count: number): string {
  return `${count} ${plural(count, 'файле', 'файлах', 'файлах')}`;
}

function counted(list: ReplaceFile[]): string {
  // Без отступа: диалог показывает текст с переносами, но начальные пробелы
  // схлопывает, и отступ в исходнике был бы обещанием, которого не видно.
  return list.map((file) => `${file.inside} — ${file.edits.length}`).join('\n');
}

/**
 * Строки с совпадениями по нескольким файлам подряд.
 *
 * Из каждого файла берётся то, что прислало ядро (первые три), а всего
 * показывается не больше двадцати: список длиннее не читают, а решение
 * принимают всё равно по первым.
 */
export function previewLines(list: ReplaceFile[], limit = PREVIEW_LINES): string[] {
  const out: string[] = [];

  for (const file of list) {
    for (const line of file.preview) {
      if (out.length >= limit) return out;
      out.push(`${file.inside}:${line.line}  ${line.text}`);
    }
  }

  return out;
}

/**
 * Текст вопроса перед заменой.
 *
 * Список файлов показывается целиком, а не первыми несколькими: это
 * единственное место, где человек видит, во что ввязывается, и «и ещё
 * 12 файлов» отвечает на вопрос ровно наоборот. Длинный список
 * прокручивается — диалог это умеет.
 */
export function describeReplace(plan: ReplacePlan, split: SplitPlan<ReplaceFile>): string {
  const total = split.editable.reduce((sum, file) => sum + file.edits.length, 0);

  const parts = [
    `${matches(total)} в ${files(split.editable.length)}. ` +
      `Просмотрено файлов: ${plan.scanned}.`,
  ];

  if (split.editable.length > 0) {
    parts.push(`Будут изменены:\n${counted(split.editable)}`);
  }

  const lines = previewLines(split.editable);
  if (lines.length > 0) {
    const all = split.editable.reduce((sum, file) => sum + file.preview.length, 0);
    const title = all > lines.length ? `Строки (первые ${lines.length}):` : 'Строки:';
    parts.push(`${title}\n${lines.join('\n')}`);
  }

  if (split.blocked.length > 0) {
    // Названо причиной, а не запретом: человек должен понять, что делать
    // дальше, — сохранить эти вкладки и повторить. Числа совпадений здесь
    // нет намеренно: они посчитаны по файлу на диске, а в такой вкладке
    // на экране другой текст (Р-138).
    parts.push(
      'Не будут тронуты, потому что открыты с несохранёнными правками:\n' +
        split.blocked.map((file) => file.inside).join('\n'),
    );
  }

  if (plan.lossy.length > 0) {
    parts.push(
      'Не читаются своей кодировкой без потерь и потому не тронуты:\n' +
        plan.lossy.join('\n'),
    );
  }

  return parts.join('\n\n');
}

/** Что сказать после замены — строкой в панели. */
export function describeDone(count: number, changed: number): string {
  return `Заменено: ${matches(count)} в ${files(changed)}`;
}

/** Что сказать после отмены. */
export function describeUndone(count: number, changed: number): string {
  return `Замена отменена: ${matches(count)} в ${files(changed)}`;
}

/** Вопрос перед отменой замены. */
export function describeUndo(
  query: string,
  replacement: string,
  count: number,
  changed: number,
): string {
  const what = replacement === '' ? `«${query}» вернётся` : `«${replacement}» станет «${query}»`;
  return `${what}: ${matches(count)} в ${files(changed)}. Файлы, изменённые после замены, останутся как есть.`;
}
