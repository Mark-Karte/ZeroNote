import { editorView } from '../editor/current';
import * as edit from '../editor/commands';
import {
  newFile,
  openFiles,
  saveActive,
  saveActiveAs,
  saveAll,
  closeActiveTab,
} from '../actions/files';
import { goToLineDialog } from '../actions/navigate';
import {
  addRootDialog,
  toggleSidebarPanel,
  quickOpen,
  commandPalette,
  tagPalette,
  searchInProject,
  followLink,
  showBacklinks,
} from '../actions/project';
import { openSearch, findNext, findPrevious } from '../state/search.svelte';
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

export const COMMANDS: Record<CommandId, () => void | Promise<unknown>> = {
  'file.new': newFile,
  'file.open': openFiles,
  'file.save': saveActive,
  'file.save-as': saveActiveAs,
  'file.save-all': saveAll,
  'file.close-tab': closeActiveTab,

  'edit.undo': inEditor(edit.undo),
  'edit.redo': inEditor(edit.redo),
  'edit.select-all': inEditor(edit.selectAll),
  'edit.duplicate-line': inEditor(edit.duplicateLine),
  'edit.delete-line': inEditor(edit.deleteLine),
  'edit.move-line-up': inEditor(edit.moveLineUp),
  'edit.move-line-down': inEditor(edit.moveLineDown),
  'edit.upper-case': inEditor(edit.upperCase),
  'edit.lower-case': inEditor(edit.lowerCase),

  'search.find': () => openSearch('find'),
  'search.replace': () => openSearch('replace'),
  'search.find-next': findNext,
  'search.find-previous': findPrevious,

  'view.go-to-line': goToLineDialog,
  'view.next-tab': nextTab,
  'view.previous-tab': previousTab,
  'view.sidebar': toggleSidebarPanel,

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
