import { message } from '@tauri-apps/plugin-dialog';

import * as ipc from '../ipc/notes';
import type { Template } from '../ipc/notes';
import { askInput } from '../state/modal.svelte';
import { showMenuAt } from '../state/menu.svelte';
import { vaultRoot } from '../state/roots.svelte';
import { editorView } from '../editor/current';
import { activeTab } from '../state/tabs.svelte';
import { refreshDirs } from '../state/tree.svelte';
import { stamp } from './daily';
import { openDropped } from './files';

/**
 * Шаблоны заметок (задача 95).
 *
 * Как в Obsidian: папка заготовок задаётся настройкой, шаблон вставляется
 * в открытую заметку или становится новой. Подстановки те же, что у заметки
 * на сегодня, и считает их то же ядро (`markdown::daily::fill`) — второй
 * реализации подстановок в проекте нет.
 *
 * Исполняемого кода в шаблонах нет и не будет: Templater из Obsidian
 * запускает JavaScript, а макросы вне области первого круга.
 */

async function report(error: unknown): Promise<void> {
  await message(String(error), { title: 'ZeroNote', kind: 'error' });
}

/** Имя файла без расширения — им подставляется `{{title}}`. */
function stemOf(path: string | null | undefined): string {
  if (!path) return '';
  const name = path.slice(path.lastIndexOf('\\') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Где показать список заготовок.
 *
 * У курсора, если открыт текст: вставка происходит именно туда, и список,
 * выехавший в другом углу окна, заставлял бы искать глазами, куда именно
 * попадёт текст. Без редактора — по центру окна.
 */
function listPoint(): { x: number; y: number } {
  const view = editorView();
  const at = view?.coordsAtPos(view.state.selection.main.head);
  if (at) return { x: at.left, y: at.bottom + 4 };
  return { x: window.innerWidth / 2, y: window.innerHeight / 3 };
}

/**
 * Показать список заготовок и позвать `use` для выбранной.
 *
 * Список — меню: заготовок у человека несколько штук, и отдельный экран
 * выбора для короткого списка был бы тяжелее самого действия. Пустая папка
 * говорит словами, а не молчит: «ничего не произошло» — худший ответ
 * на нажатую команду.
 */
async function pickTemplate(use: (template: Template) => Promise<void>): Promise<void> {
  let items: Template[];
  try {
    items = await ipc.listTemplates();
  } catch (error) {
    await report(error);
    return;
  }

  if (items.length === 0) {
    await message(
      'Папка шаблонов не задана или пуста. Укажите её в параметрах: «Папка шаблонов».',
      { title: 'ZeroNote' },
    );
    return;
  }

  const point = listPoint();
  showMenuAt(
    point,
    items.map((template) => ({ id: template.path, label: template.name })),
    (id) => {
      const chosen = items.find((template) => template.path === id);
      if (chosen) void use(chosen);
    },
  );
}

/** Прочитать заготовку с подстановками. `title` — чем заменить `{{title}}`. */
async function textOf(template: Template, title: string): Promise<string | null> {
  const { date, time } = stamp(new Date());
  try {
    return await ipc.readTemplate(template.path, date, time, title);
  } catch (error) {
    await report(error);
    return null;
  }
}

/**
 * Вставить заготовку в открытую заметку.
 *
 * Вставка идёт на место курсора и обычной правкой документа: отменяется
 * `Ctrl+Z`, попадает в черновик, ничего особенного в ней нет.
 */
export async function insertTemplate(): Promise<void> {
  if (!editorView()) {
    await message('Вставлять шаблон некуда: откройте заметку.', { title: 'ZeroNote' });
    return;
  }

  await pickTemplate(insertOne);
}

/** Вставить названную заготовку — для списка в панели, где выбор уже сделан. */
export async function insertOne(template: Template): Promise<void> {
  if (!editorView()) {
    await message('Вставлять шаблон некуда: откройте заметку.', { title: 'ZeroNote' });
    return;
  }

  const title = stemOf(activeTab()?.meta.path);
  const text = await textOf(template, title);
  if (text === null) return;

  // Представление могло смениться, пока читали файл: вставляем в то,
  // которое активно сейчас (Р-105 — то же правило, что при подстановке
  // состояния вкладки).
  const target = editorView();
  if (!target) return;

  const at = target.state.selection.main;
  target.dispatch({
    changes: { from: at.from, to: at.to, insert: text },
    selection: { anchor: at.from + text.length },
    scrollIntoView: true,
  });
  target.focus();
}

/**
 * Новая заметка из заготовки.
 *
 * Кладётся в папку заметок: это дом для записей, а спрашивать папку значило бы
 * задавать второй вопрос там, где у ответа почти всегда одно значение.
 * Имя вводится человеком — `{{title}}` в шаблоне заменяется именно им.
 */
export async function newNoteFromTemplate(): Promise<void> {
  const vault = vaultRoot();
  if (!vault) {
    await message('Папка заметок недоступна.', { title: 'ZeroNote', kind: 'error' });
    return;
  }

  await pickTemplate(newOne);
}

/** Новая заметка из названной заготовки — для списка в панели. */
export async function newOne(template: Template): Promise<void> {
  const vault = vaultRoot();
  if (!vault) {
    await message('Папка заметок недоступна.', { title: 'ZeroNote', kind: 'error' });
    return;
  }

  const name = await askInput(
    'Новая заметка',
    `Имя заметки в папке «${vault.path}». Расширение .md добавится само.`,
    '',
    'Создать',
  );
  if (name === null || name.trim() === '') return;

  // Имя даёт человек, и оно же становится `{{title}}`: заголовок заметки
  // и её имя — одно и то же, второй вопрос об этом был бы лишним.
  const title = name.trim().replace(/\.(md|markdown|txt)$/i, '');
  const fileName = /\.(md|markdown|txt)$/i.test(name.trim()) ? name.trim() : `${title}.md`;

  const text = await textOf(template, title);
  if (text === null) return;

  try {
    const path = await ipc.createNoteFromText(vault.path, fileName, text);
    await refreshDirs([vault.path]);
    await openDropped([path]);
  } catch (error) {
    await report(error);
  }
}
