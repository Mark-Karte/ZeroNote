<script lang="ts">
  import Icon from '../Icon.svelte';
  import { iconForFile } from '../../icons/files';
  import { links, refreshBacklinks } from '../../state/links.svelte';
  import { activeTab, openPath } from '../../state/tabs.svelte';
  import { roots } from '../../state/roots.svelte';
  import { indexing } from '../../state/index.svelte';

  /**
   * Панель обратных ссылок: кто ссылается на открытую заметку.
   *
   * Только настоящие `[[ссылки]]`. Упоминания голым текстом требуют
   * полнотекстового поиска по имени заметки на каждое переключение вкладки
   * и дают много шума.
   */

  const tab = $derived(activeTab());

  $effect(() => {
    // Пересобираем при смене вкладки и по окончании индексации: пока индекс
    // строится, связей у только что добавленной папки ещё нет.
    void tab?.meta.path;
    void indexing.progress.running;
    void refreshBacklinks();
  });

  function place(path: string, rootId: number): string {
    const root = roots.items.find((r) => r.id === rootId);
    const cut = root ? path.slice(root.path.length).replace(/^[\\/]/, '') : path;
    const parts = cut.split(/[\\/]/);
    parts.pop();
    return parts.join(' / ');
  }
</script>

<div class="panel">
  <header class="head">
    <span class="title">Обратные ссылки</span>
  </header>

  {#if !tab}
    <p class="note">Нет открытой заметки</p>
  {:else if tab.meta.path === null}
    <p class="note">Файл ещё не сохранён на диск</p>
  {:else if links.loading && links.items.length === 0}
    <p class="note">…</p>
  {:else if links.items.length === 0}
    <p class="note">На эту заметку никто не ссылается</p>
  {:else}
    <p class="note">Ссылается файлов: {links.items.length}</p>
    <ul class="list">
      {#each links.items as item (item.path + item.text)}
        <li>
          <button
            class="row"
            type="button"
            onclick={() => void openPath(item.path)}
            title={item.path}
          >
            <span class="line">
              <Icon name={iconForFile(item.name)} />
              <span class="name">{item.name}</span>
              <span class="place">{place(item.path, item.rootId)}</span>
            </span>
            <span class="link">
              {item.embed ? '![[' : '[['}{item.text}]]
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .head {
    display: flex;
    align-items: center;
    height: var(--zn-control-toolbar-height);
    flex: none;
    padding-inline: var(--zn-space-4);
  }

  .title {
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
    font-weight: var(--zn-font-weight-medium);
    text-transform: uppercase;
    letter-spacing: var(--zn-font-letter-spacing-caps);
  }

  .note {
    margin: 0;
    padding: 0 var(--zn-space-4) var(--zn-space-2);
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .list {
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-1);
    width: 100%;
    padding: var(--zn-space-2) var(--zn-space-4);
    border: none;
    background: transparent;
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background-color: var(--zn-color-bg-hover);
  }

  .row:focus-visible {
    outline: var(--zn-border-width-thick) solid var(--zn-color-border-focus);
    outline-offset: calc(-1 * var(--zn-border-width-thick));
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    min-width: 0;
  }

  .name {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .place {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .link {
    display: block;
    overflow: hidden;
    color: var(--zn-color-syntax-link);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
