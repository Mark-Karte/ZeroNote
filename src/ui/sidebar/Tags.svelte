<script lang="ts">
  import Icon from '../Icon.svelte';
  import { tags, refresh, showFiles } from '../../state/tags.svelte';
  import { indexing } from '../../state/index.svelte';
  import { plural } from '../plural';

  /**
   * Панель тегов: какие теги есть в проекте и чем сколько помечено.
   *
   * Отвечает на вопрос, на который палитра в режиме `#` ответить не может:
   * там надо знать, что набирать. Здесь теги видны все и сразу, самые частые
   * сверху.
   */

  $effect(() => {
    // Пересобираем по окончании индексации: пока индекс строится, тегов
    // у только что открытой папки ещё нет. Тот же приём, что в панели
    // обратных ссылок.
    void indexing.progress.running;
    void refresh();
  });
</script>

<div class="panel">
  <header class="head">
    <span class="title">Теги</span>
  </header>

  <input
    class="field"
    type="text"
    bind:value={tags.filter}
    oninput={() => void refresh()}
    placeholder="Сузить список"
    aria-label="Сузить список тегов"
    spellcheck="false"
  />

  {#if !tags.asked}
    <p class="note">…</p>
  {:else if tags.items.length === 0}
    <p class="note">
      {tags.filter === '' ? 'В проекте нет тегов' : 'Нет такого тега'}
    </p>
  {:else}
    <ul class="list">
      {#each tags.items as item (item.tag)}
        <li>
          <button
            class="row"
            type="button"
            onclick={() => void showFiles(item.tag)}
            title={`Показать заметки с тегом #${item.tag}`}
          >
            <span class="glyph"><Icon name="palette.tag" /></span>
            <span class="name">{item.tag}</span>
            <!-- Число заметок, а не «число упоминаний»: тег, поставленный
                 в заметке дважды, считается один раз — так же, как в ядре. -->
            <span
              class="count"
              title={`${item.count} ${plural(item.count, 'заметка', 'заметки', 'заметок')}`}
            >
              {item.count}
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
    font-weight: var(--zn-font-weight-strong);
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
    align-items: center;
    gap: var(--zn-space-2);
    width: 100%;
    height: var(--zn-control-row-height);
    padding-inline: var(--zn-space-4);
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

  .glyph {
    display: inline-flex;
    flex: none;
    color: var(--zn-color-fg-muted);
  }

  .name {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* Число справа и моноширинным: столбец цифр читается как столбец только
     тогда, когда цифры одной ширины. */
  .count {
    flex: none;
    color: var(--zn-color-fg-subtle);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
  }
</style>
