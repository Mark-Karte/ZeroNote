<script lang="ts">
  import NoticeStrip from './NoticeStrip.svelte';
  import StatusBar from './StatusBar.svelte';
</script>

<div class="shell">
  <NoticeStrip />

  <!-- TODO(задача 4): здесь встают полоса вкладок и редактор CodeMirror.
       Сейчас показывается состояние «нет открытых файлов» — то же самое,
       что будет видно в задаче 4 при пустом наборе вкладок. -->
  <main class="workarea">
    <p class="empty">Нет открытых файлов</p>
  </main>

  <StatusBar />
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--zn-color-bg-canvas);
  }

  .workarea {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }

  .empty {
    margin: 0;
    color: var(--zn-color-fg-subtle);
  }
</style>
