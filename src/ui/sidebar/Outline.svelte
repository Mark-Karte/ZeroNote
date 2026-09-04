<script lang="ts">
  import { outline, update, forget } from '../../state/outline.svelte';
  import { activeTab, languageOf } from '../../state/tabs.svelte';
  import { editorView } from '../../editor/current';
  import { goToLine } from '../../editor/commands';

  /**
   * Оглавление документа: заголовки markdown списком.
   *
   * Панель, а не часть панели обратных ссылок: у длинного документа
   * заголовков десятки, и делить с чем-то высоту значило бы не показывать
   * ни того ни другого.
   *
   * Пересчёт живёт в `state/outline`, а не здесь, и это существенно: пока
   * панель закрыта, компонента нет и документ никто не обходит.
   */

  const tab = $derived(activeTab());

  $effect(() => {
    const current = tab;
    // Зависимость от самого состояния, а не только от вкладки: правка
    // подменяет `tab.editor`, и без этого список замер бы на том, каким был
    // при открытии панели.
    const state = current?.editor ?? null;
    const markdown = current ? languageOf(current)?.id === 'markdown' : false;
    update(current?.meta.id ?? null, state, markdown);
  });

  // Панель закрыли — забываем список и снимаем отложенный пересчёт.
  $effect(() => forget);

  function go(line: number): void {
    const view = editorView();
    if (view) goToLine(view, line);
  }
</script>

<div class="panel">
  <header class="head">
    <span class="title">Оглавление</span>
  </header>

  {#if !tab}
    <p class="note">Нет открытой заметки</p>
  {:else if !outline.available}
    <p class="note">Оглавление есть только у markdown</p>
  {:else if outline.items.length === 0}
    <p class="note">В заметке нет заголовков</p>
  {:else}
    <ul class="list">
      {#each outline.items as item, i (item.line)}
        <li>
          <button
            class="row"
            class:current={i === outline.active}
            type="button"
            style:padding-left={`calc(var(--zn-space-4) + ${item.level - 1} * var(--zn-control-tree-indent))`}
            onclick={() => go(item.line)}
            title={`Строка ${item.line}`}
          >
            <span class="text">{item.text}</span>
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

  /* Отступ по уровню — единственное, чем в списке показана вложенность.
     Размером или начертанием её показывать нельзя: заголовок первого уровня
     в заметке обычно один, и остальные строки выглядели бы второсортными.
     Сам отступ приходит из разметки и той же мерой, что в дереве файлов:
     два списка со ступенчатым отступом в одной панели обязаны ступать
     одинаково. */
  .row {
    display: flex;
    align-items: center;
    width: 100%;
    height: var(--zn-control-row-height);
    padding-right: var(--zn-space-4);
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

  /* Раздел, в котором стоит курсор. Заливкой, как выбранная строка дерева:
     это ответ на вопрос «где я», а не выделение выбора. */
  .row.current {
    background-color: var(--zn-color-bg-selected);
    color: var(--zn-color-accent);
  }

  .row:focus-visible {
    outline: var(--zn-border-width-thick) solid var(--zn-color-border-focus);
    outline-offset: calc(-1 * var(--zn-border-width-thick));
  }

  .text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
