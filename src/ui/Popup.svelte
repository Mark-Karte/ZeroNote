<script lang="ts">
  import Icon from './Icon.svelte';
  import { iconForCommand } from '../icons/commands';
  import type { PopupItem } from './popup-item';
  import { placeMenu, type Placed } from './menu-position';
  import { labelOf } from '../keymap/binding';

  interface Props {
    items: PopupItem[];
    /**
     * Положение якоря на экране — по нему меню и ставится. Так открываются
     * меню строки состояния: вверх и влево от нажатой кнопки.
     */
    anchor?: DOMRect | undefined;
    /**
     * Точка щелчка. Так открывается контекстное меню: вниз и вправо от неё,
     * с переворотом у края окна.
     */
    at?: { x: number; y: number } | undefined;
    onpick: (id: string) => void;
    onclose: () => void;
  }

  let { items, anchor, at, onpick, onclose }: Props = $props();

  let element = $state<HTMLDivElement | null>(null);
  let placed = $state<Placed | null>(null);

  /**
   * Меню всплывает над строкой состояния и прижимается правым краем к якорю:
   * элементы строки состояния стоят справа, и меню, растущее вправо, уехало бы
   * за окно.
   */
  const anchored = $derived(
    anchor
      ? {
          bottom: `${window.innerHeight - anchor.top}px`,
          right: `${Math.max(0, window.innerWidth - anchor.right)}px`,
        }
      : null,
  );

  /**
   * Положение от точки считается после отрисовки: до неё неизвестен размер
   * меню, а без размера нельзя понять, поместится ли оно и куда переворачивать.
   * До расчёта меню скрыто — иначе кадр-другой оно было бы видно не там.
   */
  $effect(() => {
    // Смена набора пунктов меняет размер, а смена точки — целевое место.
    void items;
    if (!at || !element) return;

    // Поле у края окна берётся из токенов, а не задаётся числом здесь:
    // тот же приём, что у высоты строки дерева.
    const margin = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--zn-space-2'),
    );

    const box = element.getBoundingClientRect();
    placed = placeMenu(
      at,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
      Number.isFinite(margin) ? margin : 0,
    );
  });

  /**
   * Escape закрывает меню и на этом всё; любое другое нажатие закрывает его
   * и уходит дальше по назначению.
   *
   * Второе — не мелочь. Пока меню не закрывалось само, `Alt+0` из-под
   * открытого меню сворачивал весь файл, а меню продолжало висеть поверх
   * изменившегося текста, показывая состояние, которого больше нет.
   * В Windows меню закрывается от любой клавиши, и правильно делает.
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }

    // Одни модификаторы меню не закрывают: пользователь набирает сочетание.
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

    onclose();
  }

  // Нажатие мимо меню закрывает его. Слушаем на этапе перехвата, чтобы
  // закрыться раньше, чем нажатие займётся чем-то ещё.
  function onPointerDown(event: PointerEvent): void {
    if (element && !element.contains(event.target as Node)) {
      onclose();
    }
  }
</script>

<!-- Окно потеряло фокус — меню закрывается: висящее поверх чужого окна
     оно выглядит как чужое меню. -->
<svelte:window
  onkeydowncapture={onKeyDown}
  onpointerdowncapture={onPointerDown}
  onblur={onclose}
/>

<div
  class="popup"
  class:placing={at !== undefined && placed === null}
  bind:this={element}
  role="menu"
  tabindex="-1"
  style:bottom={anchored ? anchored.bottom : null}
  style:right={anchored ? anchored.right : null}
  style:left={placed ? `${placed.left}px` : null}
  style:top={placed ? `${placed.top}px` : null}
>
  {#each items as item (item.id)}
    {#if item.section}
      <div class="section">{item.section}</div>
    {:else if item.divider}
      <div class="divider"></div>
    {/if}
    <button
      class="item"
      class:checked={item.checked}
      class:danger={item.danger}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      title={item.hint ?? ''}
      onclick={() => onpick(item.id)}
    >
      <!-- Место под значок занято всегда: иначе подписи разъезжались бы
           от строки к строке. Выбранный пункт показывает галочку вместо
           значка — так устроены меню Windows, и так место не удваивается. -->
      <span class="mark" class:checked={item.checked}>
        {#if item.checked}
          <Icon name="action.check" />
        {:else if iconForCommand(item.id)}
          <Icon name={iconForCommand(item.id)!} />
        {/if}
      </span>
      <span class="label">{item.label}</span>
      {#if item.key}
        <span class="key">{labelOf(item.key)}</span>
      {/if}
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
    /* Отступ по кругу, а не только сверху и снизу: пункты внутри скруглены
       сами, и без бокового поля их углы упирались бы в рамку меню. */
    padding: var(--zn-space-2);
    background-color: var(--zn-color-bg-raised);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-xl);
    box-shadow: var(--zn-shadow-overlay);
    overflow-y: auto;
    animation: rise var(--zn-motion-duration-fast) var(--zn-motion-easing);
  }

  /* Меню от точки до расчёта положения занимает место, но не видно:
     измерить его размер иначе нельзя, а показывать не там, где нужно,
     нельзя тем более. */
  .popup.placing {
    visibility: hidden;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(var(--zn-space-2));
    }
  }

  .section {
    padding: var(--zn-space-3) var(--zn-space-3) var(--zn-space-1);
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
    text-transform: uppercase;
    letter-spacing: var(--zn-font-letter-spacing-caps);
  }

  /* Раздел без названия. Поля по бокам меньше, чем у пунктов: черта отделяет
     группы, а не обводит их. */
  .divider {
    height: var(--zn-border-width);
    margin: var(--zn-space-2) var(--zn-space-2);
    background-color: var(--zn-color-border-subtle);
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    padding: var(--zn-space-2) var(--zn-space-3);
    border: none;
    border-radius: var(--zn-radius-md);
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

  /* Значок пункта — тише подписи: он помогает найти строку глазами,
     а не спорит с ней за внимание. Галочка выбранного, наоборот, акцентом:
     она сообщает состояние, а не называет действие. */
  .mark {
    display: inline-flex;
    flex: none;
    width: var(--zn-control-icon-size);
    color: var(--zn-color-fg-subtle);
  }

  .mark.checked {
    color: var(--zn-color-accent);
  }

  .item:hover:not(:disabled) .mark:not(.checked) {
    color: var(--zn-color-fg-muted);
  }

  .item:disabled .mark {
    color: var(--zn-color-border-default);
  }

  /* Необратимое действие красит и значок: корзина цветом опасности читается
     раньше подписи. */
  .item.danger .mark:not(.checked) {
    color: var(--zn-color-danger);
  }

  .item.checked {
    color: var(--zn-color-accent);
  }

  /* Необратимое — цветом опасности, как вариант в диалоге (Р-093). */
  .item.danger {
    color: var(--zn-color-danger);
  }

  .label {
    flex: 1;
    white-space: nowrap;
  }

  /* Сочетание — справа и тише подписи: это справка, а не часть пункта.
     Отступ слева не даёт ему слипнуться с длинным названием. */
  .key {
    flex: none;
    margin-left: var(--zn-space-6);
    color: var(--zn-color-fg-subtle);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
    white-space: nowrap;
  }

  .item:disabled .key {
    color: var(--zn-color-border-default);
  }
</style>
