import { listen } from '@tauri-apps/api/event';

import * as ipc from '../ipc/settings';
import type { SettingsState } from '../ipc/settings';

/**
 * Окно параметров — надстройка над `settings.toml` (Р-077).
 *
 * Своего хранилища у него нет: значения читаются из файла, изменение сразу
 * пишется обратно, а применяется оно тем же путём, что и правка файла руками —
 * через слежение за файлами и событие `appearance-changed`. Поэтому здесь нет
 * ни «применить», ни «отменить»: файл и есть состояние.
 */

export const settings = $state<{
  open: boolean;
  state: SettingsState | null;
  /** Что пошло не так при последней записи. Пусто — всё в порядке. */
  problem: string | null;
}>({
  open: false,
  state: null,
  problem: null,
});

export async function load(): Promise<void> {
  settings.state = await ipc.settingsState();
}

/**
 * Загрузить настройки при запуске и следить за файлом.
 *
 * Событие то же, что у оформления: ядро следит за `settings.toml` и присылает
 * `appearance-changed` на любую его правку. Отдельного события заводить незачем —
 * файл один, и разделять «поменялась тема» и «поменялся перенос строк» значило
 * бы решать за пользователя, что именно он там правил.
 */
export async function startSettings(): Promise<void> {
  await load();
  await listen('appearance-changed', () => {
    void load();
  });
}

/**
 * Переносить ли длинные строки. Отдельной функцией, потому что читают её
 * из редактора, а там `settings.state` может быть ещё не загружен.
 */
export function wrapEnabled(): boolean {
  return settings.state?.settings.editor.wrap ?? false;
}

/** Переключить перенос строк. Значение уезжает в файл — оно настройка. */
export async function toggleWrap(): Promise<void> {
  await put(['editor', 'wrap'], !wrapEnabled());
}

/**
 * Закрывать ли скобки при наборе.
 *
 * Умолчание `true` повторяет умолчание ядра и нужно на тот случай, когда
 * настройки ещё не приехали: несовпадение означало бы, что первые полсекунды
 * после запуска редактор ведёт себя иначе, чем потом.
 */
/**
 * Показывать ли невидимые символы. Настройка общая, как перенос строк:
 * это способ смотреть на текст, а не свойство файла.
 */
export function invisiblesEnabled(): boolean {
  return settings.state?.settings.editor.invisibles ?? false;
}

/** Переключить показ невидимых. Значение уезжает в файл — оно настройка. */
export async function toggleInvisibles(): Promise<void> {
  await put(['editor', 'invisibles'], !invisiblesEnabled());
}

/**
 * Показывать ли панель разметки над markdown-файлами.
 *
 * Умолчание `true` повторяет умолчание ядра: несовпадение означало бы, что
 * первые полсекунды после запуска панели нет, а потом она появляется.
 */
export function markdownBarEnabled(): boolean {
  return settings.state?.settings.editor.markdown_bar ?? true;
}

/** Подсказывать ли имена заметок после `[[` в markdown (Р-132). */
export function linkSuggestEnabled(): boolean {
  return settings.state?.settings.editor.link_suggest ?? true;
}

/**
 * Писать ли правки в файл без команды (Р-133, Р-141).
 *
 * Умолчание `false` повторяет умолчание ядра, и здесь это важнее обычного:
 * несовпадение означало бы, что первые полсекунды после запуска приложение
 * пишет в чужие файлы, а потом перестаёт.
 */
export function autosaveEnabled(): boolean {
  return settings.state?.settings.editor.autosave ?? false;
}

export function autoCloseEnabled(): boolean {
  return settings.state?.settings.editor.auto_close ?? true;
}

export function open(): void {
  settings.open = true;
  settings.problem = null;
  void load();
}

export function close(): void {
  settings.open = false;
}

export function toggle(): void {
  if (settings.open) {
    close();
  } else {
    open();
  }
}

/**
 * Записать настройку и перечитать файл.
 *
 * Перечитываем, а не правим копию в памяти: записать могло и не получиться,
 * а показать при этом новое значение — значит соврать. Пусть окно всегда
 * показывает то, что лежит на диске.
 */
export async function put(
  path: string[],
  value: string | number | boolean | null,
): Promise<void> {
  try {
    await ipc.updateSetting(path, value);
    settings.problem = null;
  } catch (error) {
    settings.problem = String(error);
  }
  await load();
}

/**
 * Отступ по умолчанию: чем набирать там, где файл не подсказал.
 *
 * Умолчание — четыре пробела, как в VS Code и Obsidian (Р-114). Ширина
 * ограничивается здесь, а не в ядре: в файле настроек может оказаться ноль,
 * и `' '.repeat(0)` — это отступ, которого не видно.
 */
export function indentSettings(): { style: 'tabs' | 'spaces'; width: number } {
  const editor = settings.state?.settings.editor;
  const width = editor?.indent_width ?? 4;

  return {
    style: editor?.indent_style === 'tabs' ? 'tabs' : 'spaces',
    width: Math.min(16, Math.max(1, Math.round(width))),
  };
}
