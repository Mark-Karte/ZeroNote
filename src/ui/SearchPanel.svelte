<script lang="ts">
  import Icon from './Icon.svelte';
  import {
    search,
    syncQuery,
    closeSearch,
    findNext,
    findPrevious,
    replaceCurrent,
    replaceEverything,
  } from '../state/search.svelte';

  let field = $state<HTMLInputElement | null>(null);
  let lastFocusRequest = 0;

  // Панель просит фокус при открытии и при повторном Ctrl+F: счётчик растёт,
  // и поле забирает фокус, выделяя прежний запрос под замену.
  $effect(() => {
    if (search.focusRequest !== lastFocusRequest && field) {
      lastFocusRequest = search.focusRequest;
      field.focus();
      field.select();
    }
  });

  function onFieldKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) findPrevious();
      else findNext();
    }
  }

  function toggle(flag: 'caseSensitive' | 'wholeWord' | 'regexp'): void {
    search[flag] = !search[flag];
    syncQuery();
  }

  const status = $derived.by(() => {
    if (search.term === '') return '';
    if (search.matches.invalid) return 'выражение не разобрано';
    if (search.matches.total === 0) return 'нет совпадений';
    return `${search.matches.current || 1} из ${search.matches.total}`;
  });
</script>

{#if search.open}
  <div class="panel" role="search">
    <div class="row">
      <input
        class="field"
        class:invalid={search.matches.invalid}
        type="text"
        placeholder="Найти"
        aria-label="Найти"
        bind:this={field}
        bind:value={search.term}
        oninput={syncQuery}
        onkeydown={onFieldKeyDown}
      />

      <div class="flags">
        <button
          class="flag"
          class:on={search.caseSensitive}
          type="button"
          title="Учитывать регистр"
          onclick={() => toggle('caseSensitive')}>Aa</button
        >
        <button
          class="flag"
          class:on={search.wholeWord}
          type="button"
          title="Слово целиком"
          onclick={() => toggle('wholeWord')}>|ab|</button
        >
        <button
          class="flag"
          class:on={search.regexp}
          type="button"
          title="Регулярное выражение"
          onclick={() => toggle('regexp')}>.*</button
        >
      </div>

      <span class="status" class:warn={search.matches.invalid}>{status}</span>

      <button class="action" type="button" title="Назад (Shift+F3)" onclick={findPrevious}
        >↑</button
      >
      <button class="action" type="button" title="Вперёд (F3)" onclick={findNext}>↓</button>

      <button class="action" type="button" title="Закрыть (Esc)" onclick={closeSearch}>
        <Icon name="tab.close" />
      </button>
    </div>

    {#if search.mode === 'replace'}
      <div class="row">
        <input
          class="field"
          type="text"
          placeholder="Заменить на"
          aria-label="Заменить на"
          bind:value={search.replacement}
          onkeydown={onFieldKeyDown}
        />
        <button class="action wide" type="button" onclick={replaceCurrent}>Заменить</button>
        <button class="action wide" type="button" onclick={replaceEverything}>Все</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .panel {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--zn-space-2);
    padding: var(--zn-space-2) var(--zn-space-4);
    background-color: var(--zn-color-bg-surface);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-default);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
  }

  .field {
    flex: 1;
    min-width: 0;
    padding: var(--zn-space-1) var(--zn-space-3);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-bg-canvas);
    color: var(--zn-color-fg-default);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui);
  }

  .field:focus {
    outline: none;
    border-color: var(--zn-color-border-focus);
  }

  .field.invalid {
    border-color: var(--zn-color-danger);
  }

  .flags {
    display: flex;
    flex: none;
    gap: var(--zn-space-1);
  }

  .flag,
  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--zn-control-row-height);
    height: var(--zn-control-row-height);
    padding-inline: var(--zn-space-2);
    border: var(--zn-border-width) solid transparent;
    border-radius: var(--zn-radius-sm);
    background-color: transparent;
    color: var(--zn-color-fg-muted);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
    cursor: default;
  }

  .flag:hover,
  .action:hover {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  .flag.on {
    background-color: var(--zn-color-bg-selected);
    border-color: var(--zn-color-accent);
    color: var(--zn-color-fg-default);
  }

  .action.wide {
    font-family: var(--zn-font-family-ui);
    padding-inline: var(--zn-space-3);
  }

  .status {
    flex: none;
    min-width: 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
    white-space: nowrap;
  }

  .status.warn {
    color: var(--zn-color-danger);
  }
</style>
