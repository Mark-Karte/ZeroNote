<script lang="ts">
  import WindowControls from './WindowControls.svelte';
  import { activeTab } from '../state/tabs.svelte';

  // Заголовок ведёт себя как в редакторах: имя текущего файла, звёздочка при
  // несохранённых правках, затем имя приложения.
  const title = $derived.by(() => {
    const tab = activeTab();
    if (!tab) return 'ZeroNote';
    const mark = tab.meta.modified ? '● ' : '';
    return `${mark}${tab.meta.title} — ZeroNote`;
  });
</script>

<!--
  data-tauri-drag-region превращает область в полосу перетаскивания окна:
  Tauri перехватывает нажатие и передаёт его системе. Благодаря этому
  работают и прилипание к краям экрана, и двойной щелчок для разворота —
  их обрабатывает Windows, а не мы.

  Кнопки окна лежат ВНЕ этой области: иначе нажатие на них уезжало бы
  в перетаскивание.
-->
<header class="titlebar" data-tauri-drag-region>
  <div class="title" data-tauri-drag-region>{title}</div>
  <WindowControls />
</header>

<style>
  .titlebar {
    display: flex;
    flex: none;
    align-items: center;
    height: var(--zn-control-titlebar-height);
    background-color: var(--zn-color-bg-surface);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .title {
    flex: 1;
    min-width: 0;
    padding-inline: var(--zn-space-4);
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Заголовок — часть полосы перетаскивания, ловить по нему мышь незачем. */
    pointer-events: none;
  }
</style>
