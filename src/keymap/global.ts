import {
  newFile,
  openFiles,
  saveActive,
  saveActiveAs,
  closeTab,
} from '../actions/files';
import { activeTab } from '../state/tabs.svelte';

/**
 * Оконные сочетания клавиш.
 *
 * Полная раскладка Notepad++ и её переназначение — задача 7. Здесь только то,
 * без чего редактором нельзя пользоваться, плюс отъём у вебвью сочетаний,
 * которые он считает своими.
 *
 * Обработчик стоит на этапе перехвата (`capture`) намеренно: иначе Ctrl+S
 * достанется сначала CodeMirror или вебвью, и до нас не дойдёт.
 */

interface Binding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  run: () => void | Promise<unknown>;
}

const BINDINGS: Binding[] = [
  { key: 'n', ctrl: true, run: newFile },
  { key: 'o', ctrl: true, run: openFiles },
  { key: 's', ctrl: true, run: saveActive },
  { key: 's', ctrl: true, shift: true, run: saveActiveAs },
  {
    key: 'w',
    ctrl: true,
    run: () => {
      const tab = activeTab();
      return tab ? closeTab(tab.meta.id) : undefined;
    },
  },
];

/**
 * Сочетания, которые вебвью обрабатывает сам и которые в редакторе означают
 * совсем другое. Их надо просто отнять, даже если своего действия пока нет:
 * F5 перезагружает страницу и стирает все несохранённые буферы, Ctrl+P
 * открывает системную печать, Ctrl+± меняет масштаб всего интерфейса.
 *
 * Свои действия им назначаются в задаче 7.
 */
function isWebviewDefaultToSuppress(event: KeyboardEvent): boolean {
  if (event.key === 'F5' || event.key === 'F3') return true;
  if (!event.ctrlKey) return false;
  return ['p', 'r', 'f', 'g', 'j', 'u', '+', '-', '=', '0'].includes(
    event.key.toLowerCase(),
  );
}

export function installGlobalKeymap(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    for (const binding of BINDINGS) {
      if (
        event.key.toLowerCase() === binding.key &&
        event.ctrlKey === Boolean(binding.ctrl) &&
        event.shiftKey === Boolean(binding.shift) &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        void binding.run();
        return;
      }
    }

    if (isWebviewDefaultToSuppress(event)) {
      event.preventDefault();
    }
  };

  // Масштабирование колесом с Ctrl — тоже поведение браузера, не редактора.
  const onWheel = (event: WheelEvent): void => {
    if (event.ctrlKey) event.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('wheel', onWheel);
  };
}
