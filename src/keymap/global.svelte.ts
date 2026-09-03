import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { bindingOf } from './binding';
import { COMMANDS } from './registry';

/**
 * Оконный диспетчер горячих клавиш.
 *
 * Стоит на этапе перехвата (`capture`) намеренно: иначе Ctrl+S достался бы
 * сначала CodeMirror или вебвью, и до нас не дошёл бы. Раскладка приходит
 * из ядра — там она собирается из умолчаний Notepad++ и файла пользователя.
 */

export interface KeymapState {
  bindings: Record<string, string>;
  commands: { id: string; title: string }[];
  problems: string[];
}

/**
 * Раскладка и названия команд, пришедшие из ядра.
 *
 * Реактивное состояние, а не обычные переменные: раскладка приходит из ядра
 * асинхронно, а показывают её стартовый экран и палитра. С обычными
 * переменными они успевали отрисоваться до загрузки и оставались с пустыми
 * плашками навсегда — заметить это можно было только глазами, что и вышло.
 *
 * Канонический список команд — в ядре (`keymap/mod.rs`), здесь его отражение.
 */
const keymap = $state<{
  bindings: Record<string, string>;
  titles: { id: string; title: string }[];
}>({ bindings: {}, titles: [] });

/**
 * Команды с человеческими названиями и сочетаниями — для палитры.
 *
 * Сочетание ищется обратным проходом по раскладке: канонической связью
 * является «сочетание → команда», потому что одну команду можно повесить
 * на несколько сочетаний. В список берём первое по алфавиту — чтобы подпись
 * не прыгала от запуска к запуску.
 */
export function commandList(): { id: string; title: string; binding: string | null }[] {
  const byCommand = new Map<string, string>();
  for (const binding of Object.keys(keymap.bindings).sort()) {
    const id = keymap.bindings[binding]!;
    if (!byCommand.has(id)) byCommand.set(id, binding);
  }

  return keymap.titles
    // Команда без обработчика в палитре не нужна: нажать её было бы нельзя,
    // а объяснить почему — негде.
    .filter((command) => COMMANDS[command.id])
    .map((command) => ({
      id: command.id,
      title: command.title,
      binding: byCommand.get(command.id) ?? null,
    }));
}

/**
 * Команды буфера обмена и их собственные сочетания.
 *
 * Вырезание, копирование и вставку в области текста и в полях ввода делает
 * сам вебвью, и делает правильно: он знает про построчное копирование,
 * про раздачу строк по курсорам и про то, что вставку нельзя выполнить,
 * не спросив систему. Перехватывать эти нажатия значило бы заменить рабочий
 * путь своим подражанием (Р-108).
 *
 * Но команды в реестре нужны: пункт меню нажатием клавиши не является,
 * и подпись сочетания в нём обязана приходить из раскладки (Р-107).
 *
 * Сверяется именно пара «команда — сочетание». Переназначил пользователь
 * копирование на другую клавишу — её выполняем мы, и подпись в меню
 * покажет её же. Занял `Ctrl+C` чем-то своим — копирования на нём больше
 * нет, и меню об этом честно промолчит.
 */
const PLATFORM_BINDINGS: Record<string, string> = {
  'edit.cut': 'ctrl+x',
  'edit.copy': 'ctrl+c',
  'edit.paste': 'ctrl+v',
};

/**
 * Сочетания, которые вебвью считает своими и которые в редакторе означают
 * совсем другое. Их надо отнять, даже если своего действия пока нет: F5
 * перезагружает страницу и стирает несохранённые буферы, Ctrl+P открывает
 * системную печать, Ctrl+± меняет масштаб всего интерфейса.
 *
 * Как только сочетание займёт наша команда, оно уйдёт отсюда само собой:
 * список проверяется только для несвязанных.
 */
const WEBVIEW_DEFAULTS = new Set([
  'f5',
  'ctrl+p',
  'ctrl+r',
  'ctrl+j',
  'ctrl+shift+r',
  'ctrl+=',
  'ctrl+-',
  'ctrl+0',
]);

export async function loadKeymap(): Promise<string[]> {
  const state = await invoke<KeymapState>('keymap_state');
  keymap.bindings = state.bindings;
  keymap.titles = state.commands;

  const problems = [...state.problems];

  // Сочетание, указывающее на команду без обработчика, не сделает ничего —
  // и понять почему будет неоткуда. Тест сверяет списки при сборке, но
  // проверка на живом приложении ловит и то, чего тест не видит:
  // например, недособранный реестр из-за порядка загрузки модулей.
  const orphans = [...new Set(Object.values(keymap.bindings))].filter((id) => !COMMANDS[id]);
  if (orphans.length > 0) {
    problems.push(`команды без обработчика: ${orphans.join(', ')}`);
  }
  if (Object.keys(keymap.bindings).length === 0) {
    problems.push('раскладка пуста: горячие клавиши не работают');
  }

  return problems;
}

/**
 * Фокус находится в обычном поле ввода — в панели поиска или в диалоге.
 *
 * Область текста CodeMirror сюда не попадает: она устроена как
 * `contenteditable`, но команды правки в ней как раз и должны работать.
 */
function inFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('.cm-content')) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function installGlobalKeymap(onProblems: (problems: string[]) => void): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const binding = bindingOf(event);
    if (binding === null) return;

    const command = keymap.bindings[binding];
    if (command) {
      // Буфер обмена на своих клавишах — мимо нас, к вебвью.
      if (PLATFORM_BINDINGS[command] === binding) return;

      // В поле ввода команды правки текста означают совсем другое: Ctrl+A
      // должен выделить содержимое поля, а не весь документ, Ctrl+Z —
      // отменить набор в поле, а не в буфере. Отдаём такие сочетания полю.
      //
      // Остальное — сохранение, поиск, переключение вкладок — работает
      // отовсюду: это действия над приложением, а не над текстом под курсором.
      if (command.startsWith('edit.') && inFormField(event.target)) {
        return;
      }

      const run = COMMANDS[command];
      if (run) {
        event.preventDefault();
        event.stopPropagation();
        void run();
        return;
      }
    }

    if (WEBVIEW_DEFAULTS.has(binding)) {
      event.preventDefault();
    }
  };

  // Масштабирование колесом с Ctrl — тоже поведение браузера, не редактора.
  const onWheel = (event: WheelEvent): void => {
    if (event.ctrlKey) event.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('wheel', onWheel, { passive: false });

  // Правка keymap.toml применяется на лету тем же событием, что и темы:
  // ядро следит за файлами и сообщает об изменении.
  const unlisten = listen('appearance-changed', () => {
    void loadKeymap().then(onProblems);
  });

  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('wheel', onWheel);
    void unlisten.then((stop) => stop());
  };
}
