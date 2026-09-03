import { foldAll, unfoldAll } from '@codemirror/language';
import { editorView } from '../editor/current';
import * as edit from '../editor/commands';
import { foldBlock, unfoldBlock } from '../editor/folding';
import { goToBracket } from '../editor/brackets';
import {
  newFile,
  openFiles,
  saveActive,
  saveActiveAs,
  saveAll,
  closeActiveTab,
  closeAllTabs,
} from '../actions/files';
import { copySelection, cutSelection, pasteIntoEditor } from '../actions/clipboard';
import { goToLineDialog } from '../actions/navigate';
import {
  addRootDialog,
  toggleSidebarPanel,
  quickOpen,
  commandPalette,
  tagPalette,
  showSettings,
  searchInProject,
  followLink,
  showBacklinks,
} from '../actions/project';
import { openSearch, findNext, findPrevious } from '../state/search.svelte';
import { toggleInvisibles, toggleWrap } from '../state/settings.svelte';
import { nextTab, previousTab } from '../state/tabs.svelte';

/**
 * Реестр команд: идентификатор → действие.
 *
 * Имена обязаны совпадать со списком в `src-tauri/src/keymap/mod.rs` — там
 * канонический перечень, по нему проверяется файл пользователя. Расхождение
 * валит тест `tests/keymap.test.ts`: иначе сочетание указывало бы на команду,
 * которую некому выполнить, и молча ничего не делало.
 */
export type CommandId = string;

/** Обёртка для команд, которым нужен живой редактор. */
function inEditor(run: (view: import('@codemirror/view').EditorView) => boolean) {
  return (): void => {
    const view = editorView();
    if (view) run(view);
  };
}

/** То же для команд, которые ждут ответа снаружи, — буфера обмена. */
function inEditorAsync(
  run: (view: import('@codemirror/view').EditorView) => Promise<void>,
) {
  return async (): Promise<void> => {
    const view = editorView();
    if (view) await run(view);
  };
}

export const COMMANDS: Record<CommandId, () => void | Promise<unknown>> = {
  'file.new': newFile,
  'file.open': openFiles,
  'file.save': saveActive,
  'file.save-as': saveActiveAs,
  'file.save-all': saveAll,
  'file.close-tab': closeActiveTab,
  'file.close-all': closeAllTabs,

  'edit.undo': inEditor(edit.undo),
  'edit.redo': inEditor(edit.redo),

  // Буфер обмена. Сочетания `Ctrl+X`, `Ctrl+C` и `Ctrl+V` до этих
  // обработчиков не доходят — их выполняет сам вебвью (Р-108). Сюда
  // попадают пункт меню, палитра и переназначенное сочетание.
  'edit.cut': inEditorAsync(cutSelection),
  'edit.copy': inEditorAsync(copySelection),
  'edit.paste': inEditorAsync(pasteIntoEditor),

  'edit.select-all': inEditor(edit.selectAll),
  'edit.duplicate-line': inEditor(edit.duplicateLine),
  'edit.add-cursor-next': inEditor(edit.addCursorNext),
  'edit.toggle-wrap': toggleWrap,
  'edit.delete-line': inEditor(edit.deleteLine),
  'edit.move-line-up': inEditor(edit.moveLineUp),
  'edit.move-line-down': inEditor(edit.moveLineDown),
  'edit.upper-case': inEditor(edit.upperCase),
  'edit.lower-case': inEditor(edit.lowerCase),

  'search.find': () => openSearch('find'),
  'search.replace': () => openSearch('replace'),
  'search.find-next': findNext,
  'search.find-previous': findPrevious,

  'view.invisibles': toggleInvisibles,
  'view.fold': inEditor(foldBlock),
  'view.unfold': inEditor(unfoldBlock),
  'view.fold-all': inEditor(foldAll),
  'view.unfold-all': inEditor(unfoldAll),

  'view.go-to-bracket': inEditor(goToBracket),
  'view.go-to-line': goToLineDialog,
  'view.next-tab': nextTab,
  'view.previous-tab': previousTab,
  'view.sidebar': toggleSidebarPanel,
  'view.settings': showSettings,

  'project.add-root': addRootDialog,
  'project.quick-open': quickOpen,
  'project.commands': commandPalette,
  'project.tags': tagPalette,
  'project.search': searchInProject,
  'project.follow-link': followLink,
  'project.backlinks': showBacklinks,
};

export function commandIds(): CommandId[] {
  return Object.keys(COMMANDS);
}

/**
 * Выполнить команду по имени.
 *
 * Для тех, кто зовёт команду не с клавиатуры: пункты контекстного меню
 * ссылаются на неё именем и не повторяют её тело (Р-107). Неизвестное имя
 * молча ничего не делает — это ошибка в наборе пунктов, и её ловит тест
 * `tests/menus.test.ts`, а не пользователь посреди работы.
 */
export function runCommand(id: CommandId): void {
  const run = COMMANDS[id];
  if (run) void run();
}
