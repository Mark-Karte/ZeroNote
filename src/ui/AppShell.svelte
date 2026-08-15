<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import type { UnlistenFn } from '@tauri-apps/api/event';

  import TitleBar from './TitleBar.svelte';
  import TabStrip from './TabStrip.svelte';
  import EditorHost from './EditorHost.svelte';
  import NoticeStrip from './NoticeStrip.svelte';
  import StatusBar from './StatusBar.svelte';
  import Modal from './Modal.svelte';
  import { tabs, restore } from '../state/tabs.svelte';
  import { flushNow } from '../state/persist.svelte';
  import { openDropped, closeAllTabs } from '../actions/files';
  import { checkExternalChanges } from '../actions/external';
  import { startupPaths } from '../ipc/files';
  import { installGlobalKeymap } from '../keymap/global';

  let removeKeymap: (() => void) | null = null;
  let unlistenDrop: UnlistenFn | null = null;
  let unlistenClose: UnlistenFn | null = null;
  let unlistenFocus: UnlistenFn | null = null;
  let dropActive = $state(false);

  /** О чём не удалось восстановить — показывается той же полосой, что и прочее. */
  const restoreNotices = $state<string[]>([]);

  onMount(async () => {
    removeKeymap = installGlobalKeymap();

    // Сессия восстанавливается до файлов из командной строки: если файл
    // уже был открыт в прошлый раз, он просто станет активным, а не откроется
    // второй вкладкой.
    const notices = await restore();
    for (const notice of notices) {
      restoreNotices.push(notice);
    }

    const paths = await startupPaths();
    if (paths.length > 0) {
      await openDropped(paths);
    }

    // Закрытие окна перехватывается: несохранённые буферы должны спросить,
    // а не исчезнуть. Событие приходит уже после того, как Windows решила
    // закрыть окно, поэтому закрытие нужно подтвердить вручную.
    unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (await closeAllTabs()) {
        await getCurrentWindow().destroy();
        return;
      }
      // Закрытие отменили — но всё, что успели напечатать, лучше сбросить
      // на диск прямо сейчас, не дожидаясь таймера.
      await flushNow();
    });

    // Файлы сверяются с диском при возвращении фокуса в окно: именно тогда
    // пользователь мог что-то сделать с ними в другой программе (Р-014).
    unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) void checkExternalChanges();
    });

    unlistenDrop = await getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'over') {
        dropActive = true;
      } else if (event.payload.type === 'drop') {
        dropActive = false;
        void openDropped(event.payload.paths);
      } else {
        dropActive = false;
      }
    });
  });

  onDestroy(() => {
    removeKeymap?.();
    unlistenDrop?.();
    unlistenClose?.();
    unlistenFocus?.();
  });
</script>

<div class="shell" class:drop={dropActive}>
  <TitleBar />
  <NoticeStrip extra={restoreNotices} />

  {#if tabs.items.length > 0}
    <TabStrip />
    <EditorHost />
  {:else}
    <main class="workarea">
      <p class="empty">Нет открытых файлов</p>
      <p class="hint">Ctrl+N — новый, Ctrl+O — открыть, либо перетащите файл сюда</p>
    </main>
  {/if}

  <StatusBar />
  <Modal />
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--zn-color-bg-canvas);
    /* Тонкая рамка вместо системной: окно без украшений сливается с фоном
       рабочего стола, особенно в светлой теме. */
    border: var(--zn-border-width) solid var(--zn-color-border-default);
  }

  .shell.drop {
    border-color: var(--zn-color-accent);
  }

  .workarea {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--zn-space-2);
    min-height: 0;
  }

  .empty {
    margin: 0;
    color: var(--zn-color-fg-subtle);
  }

  .hint {
    margin: 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }
</style>
