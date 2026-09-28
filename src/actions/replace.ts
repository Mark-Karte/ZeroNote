import { message } from '@tauri-apps/plugin-dialog';

import { applyEdits, cancelReplace, planReplace } from '../ipc/edits';
import type { FileEdits, ReplaceFile, ReplacePlan } from '../ipc/edits';
import { formatNumber, t, tn } from '../l10n';
import { askChoice } from '../state/modal.svelte';
import { noteStructureChange } from '../state/persist.svelte';
import { projectSearch, runNow } from '../state/project-search.svelte';
import {
  lastReplace,
  remember,
  replace,
  replaceFocusRequest,
  takeLastReplace,
} from '../state/replace.svelte';
import { roots, showPanel, rootLabel } from '../state/roots.svelte';
import { unsavedPaths } from '../state/tabs.svelte';
import { checkExternalChanges } from './external';
import { splitPlan } from './rename-plan';
import type { SplitPlan } from './rename-plan';
import {
  describeDone,
  describeReplace,
  describeUndo,
  describeUndone,
  replaceTitle,
} from './replace-plan';

/**
 * Замена по проекту (задача 88).
 *
 * Здесь и только здесь живут вопросы человеку — то же правило, что у прочих
 * действий над файлами. Порядок один и не меняется:
 *
 * 1. посчитать план, ничего не трогая;
 * 2. отделить то, что трогать нельзя (Р-138);
 * 3. показать список и спросить;
 * 4. записать и запомнить, чем это отменить.
 *
 * Третий шаг — единственное, что отличает замену по проекту от беды,
 * и потому он не пропускается никогда, даже когда файл один.
 */

async function report(error: unknown): Promise<void> {
  await message(String(error), { title: 'ZeroNote', kind: 'error' });
}

/**
 * Сколько ждать перед тем, как обновить список найденного.
 *
 * Список показывает то, что знает индекс, а индекс узнаёт об изменениях
 * от наблюдателя: тот ждёт тишины 150 мс, потом изменившиеся файлы
 * перечитываются. Повторить запрос сразу — значит получить тот же список,
 * что и до замены, и это выглядит как «замена не сработала».
 */
const REFRESH_MS = 600;

/** Обновить список найденного: файлы, которые он показывает, мы же и меняли. */
function refreshHits(): void {
  setTimeout(() => void runNow(), REFRESH_MS);
}

/** Команда «Заменить по проекту»: показать панель и раскрыть строку замены. */
export function showReplace(): void {
  showPanel('search');
  replace.open = true;
  replaceFocusRequest.value += 1;
  noteStructureChange();
}

/** Прервать идущий обход. */
export async function stopReplace(): Promise<void> {
  await cancelReplace();
}

/**
 * Заменить во всех файлах проекта.
 *
 * Запрос берётся из поля поиска **как набран**, без обрезки пробелов:
 * «TODO » с пробелом на конце — законная цель замены, а «TODO» без него
 * даёт другой результат.
 */
export async function replaceEverything(): Promise<void> {
  const query = projectSearch.query;
  const replacement = replace.replacement;
  if (query === '' || replace.running) return;

  replace.running = true;
  replace.done = '';

  let plan: ReplacePlan;
  try {
    plan = await planReplace(
      query,
      replacement,
      projectSearch.matchCase,
      projectSearch.wholeWord,
      projectSearch.regexp,
      projectSearch.rootId,
    );
  } catch (error) {
    await report(error);
    return;
  } finally {
    replace.running = false;
  }

  if (plan.stopped) {
    replace.done = t('replace.stopped');
    return;
  }

  if (plan.overflow) {
    // Число берётся из плана, а не пишется здесь: предел живёт в ядре
    // (`replace::MAX_MATCHES`), и вторая его запись во фронтенде однажды
    // разошлась бы с первой.
    await message(t('replace.overflow', { total: formatNumber(plan.total) }), {
      title: 'ZeroNote',
      kind: 'warning',
    });
    return;
  }

  const split = splitPlan(plan.files, unsavedPaths());

  if (split.editable.length === 0) {
    replace.done = describeNothing(plan, split.blocked.length);
    return;
  }

  // Показываем один список, а правим по другому: имена папок нужны глазам,
  // а записи — исходные пути.
  const answer = await askChoice(
    replaceTitle(query, replacement),
    describeReplace(plan, withRootNames(split), scopeName()),
    [
      { id: 'replace', label: t('search.replace'), primary: true },
      { id: 'cancel', label: t('common.cancel'), cancel: true },
    ],
  );
  if (answer !== 'replace') return;

  // Запись тысяч файлов идёт секундами, и молчать об этом нельзя: человек
  // уже согласился и ждёт ответа (найдено приёмкой этапа 13).
  replace.writing = true;
  let outcome;
  try {
    outcome = await applyEdits(split.editable.map(bare));
  } catch (error) {
    await report(error);
    return;
  } finally {
    replace.writing = false;
  }

  // Перечитывание открытых вкладок — не мелочь: механизм внешних изменений
  // опрашивает диск при получении окном фокуса (Р-014), а во время нашей же
  // правки окно фокус не теряет.
  await checkExternalChanges();

  const count = matchesIn(outcome.undo);
  remember({
    query,
    replacement,
    expression: projectSearch.regexp,
    matches: count,
    undo: outcome.undo,
  });
  replace.done = describeDone(count, outcome.undo.length);
  refreshHits();

  if (outcome.problems.length > 0) {
    await message(t('replace.problems', { problems: outcome.problems.join('\n') }), {
      title: 'ZeroNote',
      kind: 'warning',
    });
  }
}

/**
 * Отменить последнюю замену.
 *
 * Отменяется именно последняя и по одной: замены накладываются друг на друга,
 * и отмена третьей при живых четвёртой и пятой не нашла бы своих кусков
 * на прежних местах.
 */
export async function undoReplace(): Promise<void> {
  const last = lastReplace();
  if (last === null) {
    await message(t('replace.undo.nothing'), {
      title: 'ZeroNote',
    });
    return;
  }

  // Файлы, открытые с несохранёнными правками, отмена обходит — как их
  // обходит сама замена (Р-138, Р-222): запись под изменённым буфером
  // затёрло бы первое же сохранение. До задачи 138 отмена писала и в них,
  // и для такого файла тихо не состоялась.
  const split = splitPlan(last.undo, unsavedPaths());
  if (split.editable.length === 0) {
    await message(t('replace.undo.all-blocked'), { title: 'ZeroNote' });
    return;
  }

  const blocked =
    split.blocked.length === 0
      ? ''
      : '\n\n' +
        t('replace.undo.blocked', { list: split.blocked.map((f) => f.inside).join('\n') });

  const answer = await askChoice(
    t('replace.undo.title'),
    describeUndo(
      last.query,
      last.replacement,
      matchesIn(split.editable),
      split.editable.length,
      last.expression,
    ) + blocked,
    [
      { id: 'undo', label: t('search.project.undo'), primary: true },
      { id: 'keep', label: t('replace.undo.keep'), cancel: true },
    ],
  );
  if (answer !== 'undo') return;

  // Снимаем со стека до записи, а не после: отмена, сорвавшаяся на половине
  // файлов, повторному нажатию уже не поддастся — половину она вернула,
  // и вторая попытка нашла бы на их месте исходный текст. Обойдённые файлы
  // возвращаются в стек: отмену для них можно повторить.
  takeLastReplace();
  remember({ ...last, undo: split.blocked, matches: matchesIn(split.blocked) });

  replace.writing = true;
  let outcome;
  try {
    outcome = await applyEdits(split.editable);
  } catch (error) {
    await report(error);
    return;
  } finally {
    replace.writing = false;
  }

  await checkExternalChanges();

  replace.done = describeUndone(matchesIn(outcome.undo), outcome.undo.length);
  refreshHits();

  if (outcome.problems.length > 0) {
    await message(t('replace.undo.problems', { problems: outcome.problems.join('\n') }), {
      title: 'ZeroNote',
      kind: 'warning',
    });
  }
}

/**
 * Имя папки, в которой идёт замена. `null` — во всех сразу.
 *
 * Показывается в вопросе: «во всех открытых папках» и «в этой» — разные
 * обещания, и человек должен видеть, какое из них он подтверждает.
 */
function scopeName(): string | null {
  const id = projectSearch.rootId;
  const root = roots.items.find((item) => item.id === id);
  return id === null || !root ? null : rootLabel(root);
}

/**
 * Дописать имя папки к путям, если замена идёт по нескольким папкам сразу.
 *
 * Найдено глазами на двух проектах с одинаковой библиотекой: список выглядел
 * как «readme.md — 2» дважды подряд, и какой из них какой — не сказано ничем.
 * Путь внутри корня короток намеренно, но когда корней несколько, он
 * перестаёт быть именем.
 *
 * Меняется только показ: правится по исходному списку, эти копии никуда
 * дальше диалога не уходят.
 */
function label(rootId: number): string {
  const root = roots.items.find((item) => item.id === rootId);
  return root ? rootLabel(root) : '';
}

function withRootNames(split: SplitPlan<ReplaceFile>): SplitPlan<ReplaceFile> {
  const roots0 = new Set([...split.editable, ...split.blocked].map((f) => f.rootId));
  if (roots0.size < 2) return split;

  const named = (file: ReplaceFile): ReplaceFile => ({
    ...file,
    inside: `${label(file.rootId)} / ${file.inside}`,
  });

  return {
    editable: split.editable.map(named),
    blocked: split.blocked.map(named),
  };
}

/** Убрать из плана всё, что нужно только показу. */
function bare(file: FileEdits): FileEdits {
  return { path: file.path, inside: file.inside, edits: file.edits };
}

function matchesIn(files: FileEdits[]): number {
  return files.reduce((sum, file) => sum + file.edits.length, 0);
}

/** Почему заменять оказалось нечего. */
function describeNothing(plan: ReplacePlan, blocked: number): string {
  if (blocked > 0) {
    return t('replace.nothing.blocked');
  }
  if (plan.lossy.length > 0) {
    return t('replace.nothing.lossy');
  }
  return tn('replace.nothing', plan.scanned);
}
