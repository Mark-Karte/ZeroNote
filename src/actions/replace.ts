import { message } from '@tauri-apps/plugin-dialog';

import { applyEdits, cancelReplace, planReplace } from '../ipc/edits';
import type { FileEdits, ReplaceFile, ReplacePlan } from '../ipc/edits';
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
import { roots, showPanel } from '../state/roots.svelte';
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
    replace.done = 'Обход прерван';
    return;
  }

  if (plan.overflow) {
    // Число берётся из плана, а не пишется здесь: предел живёт в ядре
    // (`replace::MAX_MATCHES`), и вторая его запись во фронтенде однажды
    // разошлась бы с первой.
    await message(
      `Совпадений слишком много: найдено ${plan.total}, и обход не закончен. ` +
        'Список такой длины не просмотреть, а замена без просмотра — не то, ' +
        'что мы делаем. Уточните запрос или включите «слово целиком».',
      { title: 'ZeroNote', kind: 'warning' },
    );
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
      { id: 'replace', label: 'Заменить', primary: true },
      { id: 'cancel', label: 'Отмена', cancel: true },
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
    await message(`Изменены не все файлы:\n\n${outcome.problems.join('\n')}`, {
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
    await message('Отменять нечего: замен по проекту в этом сеансе не было.', {
      title: 'ZeroNote',
    });
    return;
  }

  const answer = await askChoice(
    'Отменить замену по проекту?',
    describeUndo(
      last.query,
      last.replacement,
      last.matches,
      last.undo.length,
      last.expression,
    ),
    [
      { id: 'undo', label: 'Отменить замену', primary: true },
      { id: 'keep', label: 'Оставить как есть', cancel: true },
    ],
  );
  if (answer !== 'undo') return;

  // Снимаем со стека до записи, а не после: отмена, сорвавшаяся на половине
  // файлов, повторному нажатию уже не поддастся — половину она вернула,
  // и вторая попытка нашла бы на их месте исходный текст.
  takeLastReplace();

  replace.writing = true;
  let outcome;
  try {
    outcome = await applyEdits(last.undo);
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
    await message(
      `Отмена дошла не до всех файлов — их изменили после замены:\n\n${outcome.problems.join('\n')}`,
      { title: 'ZeroNote', kind: 'warning' },
    );
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
  return id === null ? null : (roots.items.find((root) => root.id === id)?.name ?? null);
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
function withRootNames(split: SplitPlan<ReplaceFile>): SplitPlan<ReplaceFile> {
  const roots0 = new Set([...split.editable, ...split.blocked].map((f) => f.rootId));
  if (roots0.size < 2) return split;

  const named = (file: ReplaceFile): ReplaceFile => ({
    ...file,
    inside: `${roots.items.find((root) => root.id === file.rootId)?.name ?? ''} / ${file.inside}`,
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
    return 'Найденное лежит только в файлах с несохранёнными правками — сохраните их и повторите';
  }
  if (plan.lossy.length > 0) {
    return 'Найденное лежит только в файлах, которые не читаются без потерь';
  }
  return `Ничего не найдено (просмотрено файлов: ${plan.scanned})`;
}
