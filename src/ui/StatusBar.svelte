<script lang="ts">
  import Icon from './Icon.svelte';
  import { appearance } from '../theme/store.svelte';

  // TODO(задача 4): сюда добавляются кодировка, тип переносов строк
  // и позиция курсора. TODO(задача 2 -> окно параметров): элементы строки
  // состояния должны стать настраиваемыми.
  const state = $derived(appearance.current);
</script>

<footer class="statusbar">
  {#if state}
    <span class="item" title={state.dataDir}>
      <Icon name={state.portable ? 'status.folder' : 'status.folder-alert'} />
      {state.portable ? 'данные рядом с приложением' : 'данные в запасной папке'}
    </span>

    <span class="spacer"></span>

    {#if state.problems.length > 0}
      <span class="item problem" title={state.problems.join('\n')}>
        <Icon name="status.warning" />
        {state.problems.length}
      </span>
    {/if}

    <span class="item">
      {state.density === 'compact' ? 'компактно' : 'обычно'}
    </span>

    <span class="item">
      <Icon
        name={state.appearance === 'dark' ? 'status.theme-dark' : 'status.theme-light'}
      />
      {state.themeName}
    </span>
  {/if}
</footer>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    gap: var(--zn-space-4);
    height: var(--zn-control-statusbar-height);
    padding-inline: var(--zn-space-4);
    background-color: var(--zn-color-bg-surface);
    border-top: var(--zn-border-width) solid var(--zn-color-border-subtle);
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
    line-height: var(--zn-font-line-height-ui);
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: var(--zn-space-2);
    white-space: nowrap;
  }

  .spacer {
    flex: 1;
  }

  .problem {
    color: var(--zn-color-warning);
  }
</style>
