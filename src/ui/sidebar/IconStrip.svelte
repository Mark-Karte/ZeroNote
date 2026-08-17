<script lang="ts">
  import Icon from '../Icon.svelte';
  import type { IconName } from '../../icons/registry';
  import { roots, showPanel, type PanelId } from '../../state/roots.svelte';
  import { noteStructureChange } from '../../state/persist.svelte';

  /**
   * Полоса значков слева (Р-044).
   *
   * Появилась вместе со второй панелью, а не вместе с первой: полоса
   * с единственным значком занимает место и ничего не объясняет.
   *
   * Повторное нажатие на значок открытой панели закрывает полосу — так же,
   * как в VS Code: одна и та же клавиша убирает и возвращает.
   */

  const PANELS: { id: PanelId; icon: IconName; title: string }[] = [
    { id: 'tree', icon: 'panel.tree', title: 'Папки (Ctrl+B)' },
    { id: 'search', icon: 'panel.search', title: 'Поиск в проекте (Ctrl+Shift+F)' },
  ];

  function pick(id: PanelId): void {
    if (roots.sidebar && roots.panel === id) {
      roots.sidebar = false;
    } else {
      showPanel(id);
    }
    noteStructureChange();
  }
</script>

<nav class="strip" aria-label="Панели">
  {#each PANELS as panel (panel.id)}
    <button
      class="tab"
      class:active={roots.sidebar && roots.panel === panel.id}
      type="button"
      onclick={() => pick(panel.id)}
      title={panel.title}
      aria-label={panel.title}
      aria-pressed={roots.sidebar && roots.panel === panel.id}
    >
      <Icon name={panel.icon} />
    </button>
  {/each}
</nav>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    flex: none;
    width: var(--zn-control-strip-width);
    background-color: var(--zn-color-bg-surface);
    border-right: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .tab {
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--zn-control-strip-width);
    padding: 0;
    border: none;
    /* Полоска слева отмечает выбранную панель. Она есть всегда, но
       у невыбранных прозрачная: иначе значки дёргались бы на пиксель. */
    border-left: var(--zn-border-width-thick) solid transparent;
    background: transparent;
    color: var(--zn-color-fg-subtle);
    cursor: pointer;
  }

  .tab:hover {
    color: var(--zn-color-fg-default);
  }

  .tab.active {
    border-left-color: var(--zn-color-accent);
    color: var(--zn-color-fg-default);
  }

  .tab:focus-visible {
    outline: var(--zn-border-width-thick) solid var(--zn-color-border-focus);
    outline-offset: calc(-1 * var(--zn-border-width-thick));
  }
</style>
