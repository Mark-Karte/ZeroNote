<script lang="ts">
  import AppShell from './ui/AppShell.svelte';
  import { benchReport } from './bench/report-state.svelte';
</script>

<AppShell />

{#if benchReport.text}
  <!-- Отчёт измерительного стенда при ручном запуске без --bench-out. -->
  <pre class="bench">{benchReport.text}</pre>
{/if}

<style>
  .bench {
    position: fixed;
    inset-block-end: var(--zn-control-statusbar-height);
    inset-inline: 0;
    margin: 0;
    padding: var(--zn-space-4);
    background-color: var(--zn-color-bg-raised);
    border-top: var(--zn-border-width) solid var(--zn-color-border-default);
    color: var(--zn-color-fg-default);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
    line-height: var(--zn-font-line-height-ui);
    overflow: auto;
    z-index: var(--zn-z-overlay);
  }
</style>
