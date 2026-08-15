<script lang="ts">
  import type { PopupItem } from './popup-item';

  interface Props {
    items: PopupItem[];
    /** Положение якоря на экране — по нему всплывающее меню и ставится. */
    anchor: DOMRect;
    onpick: (id: string) => void;
    onclose: () => void;
  }

  let { items, anchor, onpick, onclose }: Props = $props();

  let element = $state<HTMLDivElement | null>(null);

  /**
   * Меню всплывает над строкой состояния и прижимается правым краем к якорю:
   * элементы строки состояния стоят справа, и меню, растущее вправо, уехало бы
   * за окно.
   */
  const position = $derived({
    bottom: `${window.innerHeight - anchor.top}px`,
    right: `${Math.max(0, window.innerWidth - anchor.right)}px`,
  });

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
    }
  }

  // Нажатие мимо меню закрывает его. Слушаем на этапе перехвата, чтобы
  // закрыться раньше, чем нажатие займётся чем-то ещё.
  function onPointerDown(event: PointerEvent): void {
    if (element && !element.contains(event.target as Node)) {
      onclose();
    }
  }
</script>

<svelte:window onkeydowncapture={onKeyDown} onpointerdowncapture={onPointerDown} />

<div
  class="popup"
  bind:this={element}
  role="menu"
  tabindex="-1"
  style:bottom={position.bottom}
  style:right={position.right}
>
  {#each items as item (item.id)}
    {#if item.section}
      <div class="section">{item.section}</div>
    {/if}
    <button
      class="item"
      class:checked={item.checked}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      title={item.hint ?? ''}
      onclick={() => onpick(item.id)}
    >
      <span class="mark">{item.checked ? '✓' : ''}</span>
      <span class="label">{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .popup {
    position: fixed;
    z-index: var(--zn-z-overlay);
    display: flex;
    flex-direction: column;
    min-width: min(var(--zn-control-popup-min-width), 90vw);
    max-height: 70vh;
    padding: var(--zn-space-2) 0;
    background-color: var(--zn-color-bg-raised);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-md);
    box-shadow: var(--zn-shadow-overlay);
    overflow-y: auto;
  }

  .section {
    padding: var(--zn-space-3) var(--zn-space-4) var(--zn-space-1);
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
    text-transform: uppercase;
    letter-spacing: var(--zn-font-letter-spacing-caps);
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    padding: var(--zn-space-2) var(--zn-space-4);
    border: none;
    background-color: transparent;
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    text-align: left;
    cursor: default;
  }

  .item:hover:not(:disabled) {
    background-color: var(--zn-color-bg-hover);
  }

  .item:disabled {
    color: var(--zn-color-fg-subtle);
  }

  .mark {
    flex: none;
    width: var(--zn-control-icon-size);
    color: var(--zn-color-accent);
  }

  .label {
    flex: 1;
    white-space: nowrap;
  }
</style>
