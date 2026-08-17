<script lang="ts">
  import Icon from '../Icon.svelte';
  import { iconForFile } from '../../icons/files';
  import { MARK_START, MARK_END } from '../../ipc/index';
  import {
    projectSearch,
    schedule,
    runNow,
    openHit,
  } from '../../state/project-search.svelte';
  import { roots } from '../../state/roots.svelte';

  /**
   * Панель результатов поиска по проекту.
   *
   * Отрывок приходит из FTS5 с пометками управляющими знаками — по ним он
   * и разрезается. Подставлять сюда разметку из ядра нельзя: в текстах
   * пользователя встречается что угодно, включая разметку.
   */

  let field: HTMLInputElement | undefined = $state();

  export function focusField(): void {
    field?.focus();
    field?.select();
  }

  /** Отрывок, разрезанный на обычные куски и совпадения. */
  function pieces(snippet: string): { text: string; hit: boolean }[] {
    const out: { text: string; hit: boolean }[] = [];

    for (const chunk of snippet.split(MARK_START)) {
      const [hit, ...rest] = chunk.split(MARK_END);
      if (rest.length === 0) {
        // До первой пометки — обычный текст.
        if (hit !== '') out.push({ text: hit!, hit: false });
        continue;
      }
      if (hit !== '') out.push({ text: hit!, hit: true });
      const tail = rest.join(MARK_END);
      if (tail !== '') out.push({ text: tail, hit: false });
    }
    return out;
  }

  function place(path: string, rootId: number): string {
    const root = roots.items.find((r) => r.id === rootId);
    const cut = root ? path.slice(root.path.length).replace(/^[\\/]/, '') : path;
    const parts = cut.split(/[\\/]/);
    parts.pop();
    const inside = parts.join(' / ');

    if (roots.items.length > 1 && root) {
      return inside === '' ? root.name : `${root.name} / ${inside}`;
    }
    return inside;
  }
</script>

<div class="panel">
  <header class="head">
    <span class="title">Поиск в проекте</span>
  </header>

  <input
    class="field"
    type="text"
    bind:this={field}
    bind:value={projectSearch.query}
    oninput={schedule}
    onkeydown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void runNow();
      }
    }}
    placeholder="Найти в файлах проекта"
    aria-label="Найти в проекте"
    spellcheck="false"
  />

  {#if projectSearch.running}
    <p class="note">идёт поиск…</p>
  {:else if projectSearch.searched && projectSearch.hits.length === 0}
    <p class="note">Ничего не найдено</p>
  {:else if projectSearch.hits.length > 0}
    <p class="note">Найдено файлов: {projectSearch.hits.length}</p>
  {/if}

  <ul class="list">
    {#each projectSearch.hits as hit (hit.path)}
      <li>
        <button class="row" type="button" onclick={() => void openHit(hit)} title={hit.path}>
          <span class="line">
            <Icon name={iconForFile(hit.name)} />
            <span class="name">{hit.name}</span>
            <span class="place">{place(hit.path, hit.rootId)}</span>
          </span>
          <span class="snippet">
            {#each pieces(hit.snippet) as piece}
              {#if piece.hit}<mark>{piece.text}</mark>{:else}{piece.text}{/if}
            {/each}
          </span>
        </button>
      </li>
    {/each}
  </ul>
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

  .field {
    flex: none;
    margin: 0 var(--zn-space-3) var(--zn-space-2);
    padding: var(--zn-space-2) var(--zn-space-3);
    background-color: var(--zn-color-bg-canvas);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-sm);
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
  }

  .field:focus {
    outline: none;
    border-color: var(--zn-color-border-focus);
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

  .snippet {
    display: block;
    overflow: hidden;
    color: var(--zn-color-fg-muted);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  mark {
    background-color: var(--zn-color-bg-selected);
    color: var(--zn-color-fg-default);
  }
</style>
