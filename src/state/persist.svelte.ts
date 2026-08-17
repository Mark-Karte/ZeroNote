import * as ipc from '../ipc/files';
import { tabs, textOf, viewStateOf } from './tabs.svelte';
import { roots } from './roots.svelte';

/**
 * Сохранение сессии и черновиков — инвариант 4.
 *
 * Правило простое: после аварийного завершения процесса не должно пропасть
 * ничего. Ни правок в открытых файлах, ни буферов, у которых файла на диске
 * нет вовсе.
 *
 * Два разных ритма, и это не случайность:
 *
 * * **Снимок сессии** маленький и пишется сразу при любом изменении состава
 *   вкладок: открыли, закрыли, переставили, переключились. Задержка здесь
 *   не нужна, а вот отставание снимка от реальности — вредно.
 * * **Черновики** пишутся с задержкой около двух секунд после последней правки
 *   и только для тех буферов, содержимое которых с прошлого раза менялось.
 *   Сброс десятимегабайтного буфера стоит заметного времени, и делать его
 *   на каждое нажатие клавиши нельзя.
 */

const DRAFT_DELAY_MS = 2000;

/** Быстрый снимок содержимого для проверки «менялось ли с прошлого сброса». */
let lastFlushed = new Map<number, string>();

let draftTimer: ReturnType<typeof setTimeout> | null = null;
let sessionTimer: ReturnType<typeof setTimeout> | null = null;

/** Буферы, которым нужен черновик: изменённые и те, у кого нет файла. */
function draftable() {
  return tabs.items.filter(
    (tab) => !tab.meta.large && (tab.meta.modified || tab.meta.path === null),
  );
}

async function writeSession(): Promise<void> {
  sessionTimer = null;
  const views: ipc.ViewState[] = tabs.items.map((tab) => viewStateOf(tab));
  // Сами корни ядро берёт из своего реестра — отсюда едет только то, чего оно
  // знать не может: открыта ли панель.
  await ipc.saveSession(
    views,
    tabs.activeId,
    roots.sidebar,
    roots.sidebarWidth,
    roots.panel,
  );
}

async function writeDrafts(): Promise<void> {
  draftTimer = null;

  const entries: { id: number; text: string }[] = [];
  const seen = new Map<number, string>();

  for (const tab of draftable()) {
    const text = textOf(tab);
    seen.set(tab.meta.id, text);
    // Не переписываем то, что не менялось: на больших буферах это заметно.
    if (lastFlushed.get(tab.meta.id) !== text) {
      entries.push({ id: tab.meta.id, text });
    }
  }

  lastFlushed = seen;

  if (entries.length > 0) {
    await ipc.flushDrafts(entries);
  }

  // Снимок пишется вместе с черновиками: положение курсора и прокрутки
  // тоже меняется при правке, и отставать ему незачем.
  await writeSession();
}

/** Правка в редакторе: черновик уйдёт на диск через задержку. */
export function noteEdit(): void {
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
  }
  draftTimer = setTimeout(() => {
    void writeDrafts();
  }, DRAFT_DELAY_MS);
}

/**
 * Состав вкладок изменился: снимок пишется почти сразу.
 *
 * Небольшая задержка всё же есть — открытие десятка файлов сразу не должно
 * породить десять записей подряд.
 */
export function noteStructureChange(): void {
  if (sessionTimer !== null) {
    clearTimeout(sessionTimer);
  }
  sessionTimer = setTimeout(() => {
    void writeSession();
  }, 200);
}

/** Буфер сохранён или закрыт: черновик больше не нужен. */
export async function forgetDraft(id: number): Promise<void> {
  lastFlushed.delete(id);
  await ipc.dropDraft(id);
}

/**
 * Записать всё немедленно.
 *
 * Зовётся перед закрытием окна. Это не замена черновикам по таймеру, а
 * дополнение: на аварийное завершение процесса рассчитывать здесь нельзя,
 * потому и существует задержка в две секунды.
 */
export async function flushNow(): Promise<void> {
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  if (sessionTimer !== null) {
    clearTimeout(sessionTimer);
    sessionTimer = null;
  }
  await writeDrafts();
}
