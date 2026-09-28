import type { ReplaceFile, ReplacePlan } from '../ipc/edits';
import type { SplitPlan } from './rename-plan';
import { formatNumber, t, tn } from '../l10n';

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

/**
 * Сколько файлов перечислять поимённо.
 *
 * У переименования список показывался целиком, и это было верно: ссылок
 * на заметку десятки. Замена по проекту меняет масштаб — приёмка этапа 13
 * прошла по пяти тысячам файлов, и список из пяти тысяч имён перестаёт быть
 * ответом: его не читают, а диалог из-за него перерастает экран.
 *
 * Двести имён показывают, в каких папках это происходит, — а сколько всего,
 * сказано первой строкой, и она всегда на виду.
 */
const FILE_LINES = 200;

/** Заголовок вопроса. */
export function replaceTitle(query: string, replacement: string): string {
  // Замена на пустоту — это удаление, и называть её заменой значит просить
  // согласия не на то, что произойдёт.
  return replacement === ''
    ? t('replace.title.delete', { query })
    : t('replace.title', { query, replacement });
}

function matches(count: number): string {
  return tn('replace.matches', count);
}

/** «в 3 файлах»: предлог вместе с числом — в других языках он бывает после. */
function files(count: number): string {
  return tn('plan.in-files', count);
}

function counted(list: ReplaceFile[]): string {
  // Без отступа: диалог показывает текст с переносами, но начальные пробелы
  // схлопывает, и отступ в исходнике был бы обещанием, которого не видно.
  const shown = list
    .slice(0, FILE_LINES)
    .map((file) => `${file.inside} — ${file.edits.length}`);

  const rest = list.length - shown.length;
  if (rest > 0) {
    shown.push(tn('replace.more-files', rest));
  }

  return shown.join('\n');
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
export function describeReplace(
  plan: ReplacePlan,
  split: SplitPlan<ReplaceFile>,
  scope: string | null = null,
): string {
  const total = split.editable.reduce((sum, file) => sum + file.edits.length, 0);

  // Область названа первой строкой: «во всех открытых папках» и «только
  // в этой» — разные обещания, и подтверждают их по-разному.
  const where =
    scope === null ? t('replace.all-folders') : t('replace.folder', { folder: scope });

  const parts = [
    t('replace.summary', {
      where,
      matches: matches(total),
      files: files(split.editable.length),
      scanned: formatNumber(plan.scanned),
    }),
  ];

  if (split.editable.length > 0) {
    parts.push(t('replace.editable', { list: counted(split.editable) }));
  }

  const lines = previewLines(split.editable);
  if (lines.length > 0) {
    const all = split.editable.reduce((sum, file) => sum + file.preview.length, 0);
    const title =
      all > lines.length ? t('replace.lines.first', { count: lines.length }) : t('replace.lines');
    parts.push(`${title}\n${lines.join('\n')}`);
  }

  if (split.blocked.length > 0) {
    // Названо причиной, а не запретом: человек должен понять, что делать
    // дальше, — сохранить эти вкладки и повторить. Числа совпадений здесь
    // нет намеренно: они посчитаны по файлу на диске, а в такой вкладке
    // на экране другой текст (Р-138).
    parts.push(t('plan.blocked', { list: split.blocked.map((file) => file.inside).join('\n') }));
  }

  if (plan.lossy.length > 0) {
    parts.push(t('replace.lossy', { list: plan.lossy.join('\n') }));
  }

  return parts.join('\n\n');
}

/** Что сказать после замены — строкой в панели. */
export function describeDone(count: number, changed: number): string {
  return t('replace.done', { matches: matches(count), files: files(changed) });
}

/** Что сказать после отмены. */
export function describeUndone(count: number, changed: number): string {
  return t('replace.undone', { matches: matches(count), files: files(changed) });
}

/**
 * Вопрос перед отменой замены.
 *
 * Замену по выражению называем выражением, а не подстановкой: «$2=$1» станет
 * «(\w+)=(\w+)» — не то, что произойдёт, и человек прочитает это как
 * бессмыслицу. Вернётся то, что было в файлах, а было там не выражение.
 */
export function describeUndo(
  query: string,
  replacement: string,
  count: number,
  changed: number,
  expression = false,
): string {
  const what = expression
    ? t('replace.undo.expression', { query, replacement })
    : replacement === ''
      ? t('replace.undo.deleted', { query })
      : t('replace.undo.plain', { query, replacement });

  return t('replace.undo.text', { what, matches: matches(count), files: files(changed) });
}
