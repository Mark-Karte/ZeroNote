<script lang="ts">
  // Этап 1, задача 1: каркас. Редактора здесь ещё нет — он появляется в задаче 4.
  // Единственное назначение этого экрана сейчас — дать честную точку
  // «интерфейс отрисован и готов принимать ввод» для замера старта.
  import { version } from './version';
  import { benchReport } from './bench/report-state.svelte';
</script>

<main>
  <h1>ZeroNote</h1>
  <p class="version">версия {version}</p>
  <!-- TODO(задача 4): здесь будут вкладки, редактор CodeMirror и строка состояния. -->
  <p class="stub">Каркас. Редактор появится в задаче 4 этапа 1.</p>
  {#if benchReport.text}
    <pre class="bench">{benchReport.text}</pre>
  {/if}
</main>

<style>
  /* Задача 1 намеренно не вводит токены оформления: слой токенов — это задача 2,
     и он должен появиться сразу целиком, а не расползаться кусками отсюда.
     Эти правила будут удалены вместе с этим экраном. */
  main {
    font-family: system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 0.25rem;
  }
  h1 {
    margin: 0;
    font-weight: 600;
  }
  .version,
  .stub {
    margin: 0;
    opacity: 0.6;
    font-size: 0.9rem;
  }
  .bench {
    margin-top: 1rem;
    font-size: 0.75rem;
    text-align: left;
    max-width: 90vw;
    overflow: auto;
  }
</style>
