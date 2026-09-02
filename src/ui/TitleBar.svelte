<script lang="ts">
  import Icon from './Icon.svelte';
  import WindowControls from './WindowControls.svelte';
  import { crumbsFor } from './crumbs';
  import { activeTab } from '../state/tabs.svelte';
  import { roots } from '../state/roots.svelte';
  import { quickOpen } from '../actions/project';

  const tab = $derived(activeTab());

  /**
   * Путь активного файла крошками. Имя файла и точка правок остались
   * на вкладке: повторять их в шапке незачем, а путь на вкладку не влезает.
   */
  const crumbs = $derived(crumbsFor(tab?.meta.path ?? null, roots.items));

  /** Полный путь — подсказкой: крошки показывают не всё. */
  const fullPath = $derived(tab?.meta.path ?? '');
</script>

<!--
  data-tauri-drag-region превращает область в полосу перетаскивания окна:
  Tauri перехватывает нажатие и передаёт его системе. Благодаря этому
  работают и прилипание к краям экрана, и двойной щелчок для разворота —
  их обрабатывает Windows, а не мы.

  Кнопки и поле поиска лежат ВНЕ этой области: иначе нажатие на них уезжало
  бы в перетаскивание.
-->
<header class="titlebar" data-tauri-drag-region>
  <div class="brand" data-tauri-drag-region>
    <span class="mark"><Icon name="app.mark" /></span>
    <span class="name">ZeroNote</span>
  </div>

  <div class="crumbs" title={fullPath} data-tauri-drag-region>
    {#each crumbs as crumb, index (index)}
      {#if index > 0}<span class="sep">/</span>{/if}
      <span class="crumb" class:leaf={crumb.leaf}>{crumb.text}</span>
    {/each}
  </div>

  <!--
    Поле по центру окна, а не по центру оставшегося места: крошки слева
    растут вместе с длиной пути, и поле съезжало бы вслед за ними.
  -->
  <button
    class="find"
    type="button"
    onclick={quickOpen}
    title="Быстрое открытие файла по имени (Ctrl+P)"
  >
    <span class="find-icon"><Icon name="panel.search" /></span>
    <span class="find-text">Найти файл или команду</span>
    <kbd class="find-key">Ctrl P</kbd>
  </button>

  <WindowControls />
</header>

<style>
  .titlebar {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--zn-space-4);
    height: var(--zn-control-titlebar-height);
    padding-inline-start: var(--zn-space-4);
    background-color: var(--zn-color-bg-surface);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .brand {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--zn-space-3);
    pointer-events: none;
  }

  /* Подложка знака — единственное место, где акцент работает заливкой
     на всю высоту элемента. Поэтому цвет буквы берётся из своей роли,
     а не из общего текста. */
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* Подложка на пару пикселей больше самого значка: без запаса скругление
       съедает углы буквы, и знак читается кружком, а не квадратом. */
    width: calc(var(--zn-control-icon-size) + var(--zn-space-2));
    height: calc(var(--zn-control-icon-size) + var(--zn-space-2));
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-accent);
    color: var(--zn-color-fg-on-accent);
  }

  .name {
    color: var(--zn-color-fg-default);
    font-weight: var(--zn-font-weight-strong);
  }

  .crumbs {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: var(--zn-space-2);
    color: var(--zn-color-fg-subtle);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
    white-space: nowrap;
    overflow: hidden;
    pointer-events: none;
  }

  .crumb {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Имя файла ярче пути к нему: путь — это контекст, а файл — то, что открыто. */
  .crumb.leaf {
    color: var(--zn-color-fg-muted);
  }

  .sep {
    flex: none;
    opacity: 0.6;
  }

  .find {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    width: var(--zn-control-search-width);
    height: var(--zn-control-field-height);
    padding-inline: var(--zn-space-3);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-lg);
    background-color: var(--zn-color-bg-raised);
    color: var(--zn-color-fg-subtle);
    font-family: inherit;
    font-size: var(--zn-font-size-ui-small);
    cursor: default;
    transition: border-color var(--zn-motion-duration-fast) var(--zn-motion-easing);
  }

  .find:hover {
    border-color: var(--zn-color-accent);
    color: var(--zn-color-fg-muted);
  }

  .find-icon {
    display: inline-flex;
    flex: none;
  }

  .find-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-align: start;
    text-overflow: ellipsis;
  }

  .find-key {
    flex: none;
    padding-inline: var(--zn-space-2);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-sm);
    color: var(--zn-color-fg-subtle);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
  }

  /* Окно узкое — поле уходит первым: крошки и кнопки окна нужнее.
     Порог в единицах шрифта, а не в пикселях: при крупном шрифте
     интерфейса тесно становится раньше. */
  @media (width < 60rem) {
    .find {
      display: none;
    }
  }
</style>
