<script lang="ts">
  import Icon from '../Icon.svelte';
  import { iconForFile } from '../../icons/files';
  import { snippetPieces } from '../snippet';
  import {
    projectSearch,
    schedule,
    runNow,
    openHit,
  } from '../../state/project-search.svelte';
  import { roots } from '../../state/roots.svelte';
  import {
    canUndoReplace,
    replace,
    replaceFocusRequest,
  } from '../../state/replace.svelte';
  import {
    replaceEverything,
    stopReplace,
    undoReplace,
  } from '../../actions/replace';

  /**
   * Панель результатов поиска по проекту.
   *
   * Отрывок приходит из FTS5 с пометками управляющими знаками — по ним он
   * и разрезается. Подставлять сюда разметку из ядра нельзя: в текстах
   * пользователя встречается что угодно, включая разметку. Разбор и обрезка
   * ведущего контекста — в `ui/snippet.ts`.
   */

  let field: HTMLInputElement | undefined = $state();
  let replaceField: HTMLInputElement | undefined = $state();
  let lastFocusRequest = 0;

  export function focusField(): void {
    field?.focus();
    field?.select();
  }

  // Команда «Заменить в проекте» раскрывает строку замены и просит фокус.
  // Счётчиком, а не признаком: повторный вызов обязан вернуть фокус тоже.
  $effect(() => {
    if (replaceFocusRequest.value !== lastFocusRequest && replaceField) {
      lastFocusRequest = replaceFocusRequest.value;
      replaceField.focus();
      replaceField.select();
    }
  });

  // Выбранную папку могли убрать из дерева, пока панель была открыта.
  // Тогда выбор возвращается ко «всем папкам»: искать в том, чего нет,
  // нельзя, а список, молча оставшийся пустым, ничего не объясняет.
  $effect(() => {
    const id = projectSearch.rootId;
    if (id !== null && !roots.items.some((root) => root.id === id)) {
      projectSearch.rootId = null;
    }
  });

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
    <button
      class="toggle"
      class:on={replace.open}
      type="button"
      title="Замена по проекту"
      aria-pressed={replace.open}
      onclick={() => (replace.open = !replace.open)}
    >
      <Icon name="cmd.replace" />
    </button>
  </header>

  {#if roots.items.length > 1}
    <!-- Выбор папки появляется только когда папок больше одной: строка
         «во всех папках» при единственной папке — это выбор без выбора. -->
    <select
      class="scope"
      aria-label="Где искать"
      value={projectSearch.rootId === null ? '' : String(projectSearch.rootId)}
      onchange={(event) => {
        const picked = event.currentTarget.value;
        projectSearch.rootId = picked === '' ? null : Number(picked);
        void runNow();
      }}
    >
      <option value="">Во всех папках</option>
      {#each roots.items as root (root.id)}
        <option value={String(root.id)}>{root.name}</option>
      {/each}
    </select>
  {/if}

  <div class="bar">
    <input
      class="field"
      class:invalid={projectSearch.error !== ''}
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
      placeholder={projectSearch.regexp
        ? 'Выражение; Enter — искать'
        : 'Найти в файлах проекта'}
      aria-label="Найти в проекте"
      spellcheck="false"
    />

    <div class="flags">
      <button
        class="flag"
        class:on={projectSearch.matchCase}
        type="button"
        title="Учитывать регистр"
        onclick={() => {
          projectSearch.matchCase = !projectSearch.matchCase;
          void runNow();
        }}>Aa</button
      >
      <button
        class="flag"
        class:on={projectSearch.wholeWord}
        type="button"
        title="Слово целиком"
        onclick={() => {
          projectSearch.wholeWord = !projectSearch.wholeWord;
          void runNow();
        }}>|ab|</button
      >
      <button
        class="flag"
        class:on={projectSearch.regexp}
        type="button"
        title="Регулярное выражение"
        onclick={() => {
          projectSearch.regexp = !projectSearch.regexp;
          void runNow();
        }}>.*</button
      >
    </div>
  </div>

  {#if replace.open}
    <div class="bar">
      <input
        class="field replacement"
        type="text"
        bind:this={replaceField}
        bind:value={replace.replacement}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void replaceEverything();
          }
        }}
        placeholder={projectSearch.regexp ? 'Заменить на; $1 — группа' : 'Заменить на'}
        aria-label="Заменить на"
        spellcheck="false"
      />
    </div>

    <div class="bar">
      {#if replace.running}
        <button class="action" type="button" onclick={() => void stopReplace()}>
          Прервать
        </button>
        <span class="note inline">идёт обход файлов…</span>
      {:else}
        <button
          class="action"
          type="button"
          disabled={projectSearch.query === ''}
          onclick={() => void replaceEverything()}
        >
          Заменить всё
        </button>
        {#if canUndoReplace()}
          <button class="action" type="button" onclick={() => void undoReplace()}>
            Отменить замену
          </button>
        {/if}
      {/if}
    </div>

    {#if replace.done !== ''}
      <p class="note">{replace.done}</p>
    {/if}
  {/if}

  {#if projectSearch.error !== ''}
    <p class="note warn">{projectSearch.error}</p>
  {:else if projectSearch.running}
    <p class="note">идёт поиск…</p>
  {:else if projectSearch.searched && projectSearch.hits.length === 0}
    <p class="note">Ничего не найдено</p>
  {:else if projectSearch.hits.length > 0}
    <p class="note">
      Найдено файлов: {projectSearch.hits.length}{projectSearch.limited
        ? ' — показаны первые'
        : ''}
    </p>
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
            {#each snippetPieces(hit.snippet) as piece}
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
    justify-content: space-between;
    gap: var(--zn-space-2);
    height: var(--zn-control-toolbar-height);
    flex: none;
    padding-inline: var(--zn-space-4);
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--zn-control-toolbar-button-size);
    height: var(--zn-control-toolbar-button-size);
    padding: 0;
    border: var(--zn-border-width) solid transparent;
    border-radius: var(--zn-radius-sm);
    background: transparent;
    color: var(--zn-color-fg-muted);
    cursor: default;
  }

  .toggle:hover {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  .toggle.on {
    background-color: var(--zn-color-bg-selected);
    border-color: var(--zn-color-accent);
    color: var(--zn-color-fg-default);
  }

  /* Свой класс, а не `.row`: строка результата поиска ниже зовётся так же
     и стоит в стилях позже — она бы и побеждала. Найдено глазами: поле
     замены и кнопки встали столбиком по центру. */
  .bar {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    flex: none;
    margin: 0 var(--zn-space-3) var(--zn-space-2);
  }

  .bar .field {
    margin: 0;
    flex: 1;
    min-width: 0;
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

  .action {
    font-family: var(--zn-font-family-ui);
    border-color: var(--zn-color-border-default);
    padding-inline: var(--zn-space-3);
  }

  .flag:hover,
  .action:hover:not(:disabled) {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  .action:disabled {
    color: var(--zn-color-fg-subtle);
    border-color: var(--zn-color-border-subtle);
  }

  .flag.on {
    background-color: var(--zn-color-bg-selected);
    border-color: var(--zn-color-accent);
    color: var(--zn-color-fg-default);
  }

  .note.inline {
    padding: 0;
  }

  .title {
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
    font-weight: var(--zn-font-weight-strong);
    text-transform: uppercase;
    letter-spacing: var(--zn-font-letter-spacing-caps);
  }

  .scope {
    flex: none;
    margin: 0 var(--zn-space-3) var(--zn-space-2);
    padding: var(--zn-space-1) var(--zn-space-2);
    background-color: var(--zn-color-bg-canvas);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-sm);
    color: var(--zn-color-fg-muted);
    font-family: var(--zn-font-family-ui);
    font-size: var(--zn-font-size-ui-small);
  }

  .scope:focus {
    outline: none;
    border-color: var(--zn-color-border-focus);
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

  .field.invalid {
    border-color: var(--zn-color-danger);
  }

  .note.warn {
    color: var(--zn-color-danger);
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
