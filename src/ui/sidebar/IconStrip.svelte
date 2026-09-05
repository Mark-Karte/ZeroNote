<script lang="ts">
  import Icon from '../Icon.svelte';
  import type { IconName } from '../../icons/registry';
  import { roots, showPanel, type PanelId } from '../../state/roots.svelte';
  import { noteStructureChange } from '../../state/persist.svelte';
  import { settings, toggle as toggleSettings } from '../../state/settings.svelte';

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
    { id: 'links', icon: 'panel.links', title: 'Обратные ссылки' },
    { id: 'outline', icon: 'panel.outline', title: 'Оглавление документа' },
    // Значок общий с палитрой: это одна и та же решётка, и вторая копия
    // того же рисунка ради имени с приставкой `panel.` разошлась бы
    // с первой при первой же правке.
    { id: 'tags', icon: 'palette.tag', title: 'Теги проекта' },
    // Значок тот же, что у команды «поставить закладку»: панель
    // и команда — про одно и то же (Р-148).
    { id: 'bookmarks', icon: 'cmd.bookmark', title: 'Закладки' },
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

<nav class="strip panel" aria-label="Панели">
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

  <!-- Параметры внизу полосы, как в референсе: это не панель проекта,
       и в общем ряду им не место. -->
  <button
    class="tab bottom"
    class:active={settings.open}
    type="button"
    onclick={toggleSettings}
    title="Параметры (Ctrl+,)"
    aria-label="Параметры"
    aria-pressed={settings.open}
  >
    <Icon name="panel.settings" />
  </button>
</nav>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    flex: none;
    align-items: center;
    gap: var(--zn-space-2);
    width: var(--zn-control-strip-width);
    padding-block: var(--zn-space-3);
    background-color: var(--zn-color-bg-surface);
  }

  /* Выбранная панель отмечена заливкой самой кнопки, а не полоской у края:
     у полосы теперь скруглённые углы, и полоска на них не ложится. */
  .tab {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    /* Крупнее строки списка: это единственная навигация в окне, и в плитке
       такого размера строчный значок теряется. */
    --zn-control-icon-size: var(--zn-control-icon-size-tile);
    width: var(--zn-control-strip-button-size);
    height: var(--zn-control-strip-button-size);
    padding: 0;
    border: none;
    border-radius: var(--zn-radius-xl);
    background: transparent;
    color: var(--zn-color-fg-subtle);
    cursor: pointer;
    transition: background-color var(--zn-motion-duration-fast) var(--zn-motion-easing);
  }

  .tab:hover {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  .tab.active {
    background-color: var(--zn-color-bg-selected);
    color: var(--zn-color-accent);
  }

  .bottom {
    margin-top: auto;
  }

  .tab:focus-visible {
    outline: var(--zn-border-width-thick) solid var(--zn-color-border-focus);
    outline-offset: calc(-1 * var(--zn-border-width-thick));
  }
</style>
