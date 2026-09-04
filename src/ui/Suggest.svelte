<script lang="ts">
  import Icon from './Icon.svelte';
  import { iconForFile, kindOf } from '../icons/files';
  import { suggest, move, accept, close, dismiss } from '../state/suggest.svelte';
  import { roots } from '../state/roots.svelte';
  import { placeAtCaret, type Placed } from './menu-position';

  /**
   * Список заметок, всплывающий при наборе `[[` (Р-132).
   *
   * От палитры отличается тем, что не забирает фокус: курсор остаётся
   * в тексте, набор продолжается, а список идёт следом. Поэтому клавиши
   * ловятся на окне, а не на самом списке, — брать их иначе неоткуда.
   */

  let element = $state<HTMLDivElement | null>(null);
  let placed = $state<Placed | null>(null);

  /**
   * Положение считается после отрисовки: до неё неизвестен размер списка,
   * а без размера нельзя понять, помещается ли он под строкой. До расчёта
   * список скрыт — иначе кадр-другой он был бы виден не там.
   */
  $effect(() => {
    // Смена набора меняет высоту, смена курсора — целевое место.
    void suggest.items;
    const caret = suggest.caret;
    if (!caret || !element) return;

    const margin = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--zn-space-2'),
    );

    const box = element.getBoundingClientRect();
    placed = placeAtCaret(
      caret,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
      Number.isFinite(margin) ? margin : 0,
    );
  });

  /** Выбранная строка должна оставаться на виду при переборе клавишами. */
  $effect(() => {
    void suggest.selected;
    element?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
  });

  /**
   * Клавиши списка — на этапе перехвата, иначе их разберёт CodeMirror:
   * стрелки уведут курсор, Enter вставит перевод строки, Escape схлопнет
   * выделение. Всё остальное уходит в редактор как ни в чём не бывало —
   * подсказка не должна мешать печатать дальше.
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (!suggest.open) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    // Escape прогоняет подсказку до конца этой ссылки, а не просто закрывает:
    // иначе она вернулась бы от первой же смены фокуса окна.
    if (event.key === 'Escape') {
      stop(event);
      dismiss();
      return;
    }
    if (event.key === 'ArrowDown') {
      stop(event);
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      stop(event);
      move(-1);
      return;
    }
    // Enter и Tab — оба привычны по другим редакторам, и оба здесь свободны:
    // пока список открыт, перевод строки и отступ подождут.
    if (event.key === 'Enter' || event.key === 'Tab') {
      stop(event);
      void accept();
    }
  }

  function stop(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Щелчок мимо списка закрывает его — но только мимо. Внутри списка
   * нажатие гасится: иначе редактор потеряет фокус и выделение раньше,
   * чем мы успеем вставить ссылку.
   */
  function onPointerDown(event: PointerEvent): void {
    if (element && !element.contains(event.target as Node)) close();
  }

  /** Имя, разрезанное на совпавшие и обычные куски — как в палитре. */
  function pieces(name: string, matched: number[]): { text: string; hit: boolean }[] {
    const chars = [...name];
    const marks = new Set(matched);
    const out: { text: string; hit: boolean }[] = [];

    for (let i = 0; i < chars.length; i += 1) {
      const hit = marks.has(i);
      const last = out[out.length - 1];
      if (last && last.hit === hit) {
        last.text += chars[i];
      } else {
        out.push({ text: chars[i]!, hit });
      }
    }
    return out;
  }

  /** Где файл лежит: путь без имени и без пути корня. */
  function place(path: string, rootId: number): string {
    const root = roots.items.find((r) => r.id === rootId);
    const cut = root ? path.slice(root.path.length).replace(/^[\\/]/, '') : path;
    const parts = cut.split(/[\\/]/);
    parts.pop();
    return parts.join(' / ');
  }
</script>

<svelte:window onkeydowncapture={onKeyDown} onpointerdowncapture={onPointerDown} onblur={close} />

{#if suggest.open}
  <div
    class="suggest"
    class:placing={placed === null}
    bind:this={element}
    role="listbox"
    aria-label="Заметки проекта"
    tabindex="-1"
    style:left={placed ? `${placed.left}px` : null}
    style:top={placed ? `${placed.top}px` : null}
    onmousedown={(event) => event.preventDefault()}
  >
    {#each suggest.items as item, i (item.path)}
      <button
        class="row"
        class:selected={i === suggest.selected}
        type="button"
        role="option"
        aria-selected={i === suggest.selected}
        title={item.path}
        onclick={() => {
          suggest.selected = i;
          void accept();
        }}
        onmousemove={() => (suggest.selected = i)}
      >
        <span class="glyph" data-kind={kindOf(item.name)}>
          <Icon name={iconForFile(item.name)} />
        </span>
        <span class="name">
          {#each pieces(item.name, item.matched) as piece}
            {#if piece.hit}<mark>{piece.text}</mark>{:else}{piece.text}{/if}
          {/each}
        </span>
        <span class="aside">{place(item.path, item.rootId)}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .suggest {
    position: fixed;
    z-index: var(--zn-z-overlay);
    display: flex;
    flex-direction: column;
    width: min(var(--zn-control-popup-min-width), 90vw);
    /* Ниже, чем у меню: список стоит посреди текста, и заслонять им пол-экрана
       значило бы прятать то, ради чего он открыт. */
    max-height: 40vh;
    padding: var(--zn-space-2);
    background-color: var(--zn-color-bg-raised);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-xl);
    box-shadow: var(--zn-shadow-overlay);
    overflow-y: auto;
    animation: rise var(--zn-motion-duration-fast) var(--zn-motion-easing);
  }

  /* До расчёта положения список занимает место, но не виден: измерить его
     иначе нельзя, а показать не там, где нужно, нельзя тем более. */
  .suggest.placing {
    visibility: hidden;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(var(--zn-space-2));
    }
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    width: 100%;
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

  .row.selected {
    background-color: var(--zn-color-bg-selected);
  }

  .glyph {
    display: inline-flex;
    flex: none;
    color: var(--zn-color-fg-muted);
  }

  .glyph[data-kind='note'] {
    color: var(--zn-color-file-note);
  }

  .glyph[data-kind='code'] {
    color: var(--zn-color-file-code);
  }

  .glyph[data-kind='data'] {
    color: var(--zn-color-file-data);
  }

  .glyph[data-kind='other'] {
    color: var(--zn-color-file-other);
  }

  .name {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  mark {
    background: transparent;
    color: var(--zn-color-accent);
    font-weight: var(--zn-font-weight-strong);
  }

  /* Путь — справа и тише имени: он отвечает на вопрос «который из двух»,
     а не называет заметку. */
  .aside {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: right;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }
</style>
