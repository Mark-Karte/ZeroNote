<script lang="ts">
  import Icon from '../Icon.svelte';
  import { roots } from '../../state/roots.svelte';
  import { addRootDialog, removeRoot, createProject } from '../../actions/project';

  /**
   * Боковая панель: корни рабочего пространства.
   *
   * Дерева файлов здесь пока нет — оно задача 10 и встанет внутрь этой же
   * панели. Полоса значков (Р-044) появится тогда же, когда панелей станет
   * больше одной: полоса с единственным значком объясняет меньше, чем занимает.
   */
</script>

<aside class="sidebar">
  <header class="head">
    <span class="title">Папки</span>
    <button
      class="action"
      type="button"
      onclick={addRootDialog}
      title="Открыть папку (Ctrl+Shift+O)"
      aria-label="Открыть папку"
    >
      <Icon name="action.add-folder" />
    </button>
  </header>

  {#if roots.items.length === 0}
    <p class="empty">Папок нет</p>
    <p class="hint">Ctrl+Shift+O — открыть папку как проект</p>
  {:else}
    <ul class="list">
      {#each roots.items as root (root.id)}
        <li class="root" class:missing={!root.available}>
          <Icon name={root.available ? 'status.folder' : 'status.folder-alert'} />
          <span class="name" title={root.path}>{root.name}</span>

          {#if !root.hasProjectFile}
            <button
              class="action"
              type="button"
              onclick={() => createProject(root.id)}
              title="Создать zeronote.toml"
              aria-label="Создать файл проекта"
            >
              <Icon name="action.project-file" />
            </button>
          {/if}

          <button
            class="action"
            type="button"
            onclick={() => removeRoot(root.id)}
            title="Убрать папку из рабочего пространства"
            aria-label="Убрать папку"
          >
            <Icon name="action.remove" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: var(--zn-control-sidebar-width);
    flex: none;
    min-height: 0;
    overflow: auto;
    background-color: var(--zn-color-bg-surface);
    border-right: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    height: var(--zn-control-toolbar-height);
    flex: none;
    padding: 0 var(--zn-space-2) 0 var(--zn-space-4);
  }

  .title {
    flex: 1;
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
    font-weight: var(--zn-font-weight-medium);
    text-transform: uppercase;
    letter-spacing: var(--zn-font-letter-spacing-caps);
  }

  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--zn-control-row-height);
    height: var(--zn-control-row-height);
    padding: 0;
    border: none;
    border-radius: var(--zn-radius-sm);
    background: transparent;
    color: var(--zn-color-fg-muted);
    cursor: pointer;
  }

  .action:hover {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  .action:focus-visible {
    outline: var(--zn-border-width-thick) solid var(--zn-color-border-focus);
    outline-offset: calc(-1 * var(--zn-border-width-thick));
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .root {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
    min-height: var(--zn-control-row-height);
    padding: 0 var(--zn-space-2) 0 var(--zn-space-4);
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-ui);
  }

  .root:hover {
    background-color: var(--zn-color-bg-hover);
  }

  /* Кнопки появляются на наведении и на клавиатурном фокусе: иначе до них
     нельзя добраться без мыши. */
  .root .action {
    visibility: hidden;
  }

  .root:hover .action,
  .root:focus-within .action {
    visibility: visible;
  }

  .name {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .missing {
    color: var(--zn-color-fg-subtle);
  }

  .empty,
  .hint {
    margin: 0;
    padding: var(--zn-space-2) var(--zn-space-4);
    color: var(--zn-color-fg-subtle);
  }

  .hint {
    padding-top: 0;
    font-size: var(--zn-font-size-ui-small);
  }
</style>
