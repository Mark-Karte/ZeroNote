<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import type { UnlistenFn } from '@tauri-apps/api/event';

  import TitleBar from './TitleBar.svelte';
  import TabStrip from './TabStrip.svelte';
  import EditorHost from './EditorHost.svelte';
  import NoticeStrip from './NoticeStrip.svelte';
  import StatusBar from './StatusBar.svelte';
  import { tabs } from '../state/tabs.svelte';
  import { openDropped } from '../actions/files';
  import { startupPaths } from '../ipc/files';
  import { installGlobalKeymap } from '../keymap/global';

  let removeKeymap: (() => void) | null = null;
  let unlistenDrop: UnlistenFn | null = null;
  let dropActive = $state(false);

  onMount(async () => {
    removeKeymap = installGlobalKeymap();

    // TODO(задача 5): здесь же восстанавливается сессия. Пока открываются
    // только файлы, переданные в командной строке.
    const paths = await startupPaths();
    if (paths.length > 0) {
      await openDropped(paths);
    }

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
  });
</script>

<div class="shell" class:drop={dropActive}>
  <TitleBar />
  <NoticeStrip />

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
