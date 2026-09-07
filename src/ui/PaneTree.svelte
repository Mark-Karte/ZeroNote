<script lang="ts">
  import PaneTree from './PaneTree.svelte';
  import PaneView from './PaneView.svelte';
  import type { LayoutNode } from '../ipc/layout';
  import { setRatio, setRatioLocal } from '../state/panes.svelte';
  import { clampRatio } from './pane-size';

  /**
   * Дерево областей (Р-207) — рисуется так же, как хранится.
   *
   * Область — `PaneView`, разделение — два потомка и граница между ними.
   * Компонент зовёт сам себя: дерево рекурсивно, и второй способ его
   * нарисовать — развернуть в список с вычислением координат — был бы
   * второй моделью того же дерева.
   */
  let { node }: { node: LayoutNode } = $props();

  let box = $state<HTMLDivElement | null>(null);
  /** Граница тащится. Обычная переменная: интерфейс от неё не зависит. */
  let dragging = false;

  function onDividerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onDividerMove(event: PointerEvent): void {
    if (!dragging || !box || node.kind !== 'split') return;
    if (event.buttons === 0) {
      finish();
      return;
    }

    const rect = box.getBoundingClientRect();
    const row = node.direction === 'row';
    const total = row ? rect.width : rect.height;
    const raw = row ? (event.clientX - rect.left) / total : (event.clientY - rect.top) / total;
    // Предел из токена, а не число в коде: обе стороны не уже области (Р-212).
    const min = parseFloat(getComputedStyle(box).getPropertyValue('--zn-control-pane-min-size'));
    setRatioLocal(node.id, clampRatio(raw, total, Number.isFinite(min) ? min : 0));
  }

  function finish(): void {
    if (!dragging) return;
    dragging = false;
    // Итог уходит в ядро один раз, а не на каждый шаг мыши: доля — часть сессии.
    if (node.kind === 'split') void setRatio(node.id, node.ratio);
  }

  function onDividerUp(event: PointerEvent): void {
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    finish();
  }
</script>

{#if node.kind === 'pane'}
  <PaneView pane={node} />
{:else}
  <div class="split" class:column={node.direction === 'column'} bind:this={box}>
    <div class="child" style:flex-basis="{node.ratio * 100}%">
      <PaneTree node={node.first} />
    </div>
    <!-- Граница живёт в зазоре между панелями: тот же зазор, что между
         панелью и рабочей областью (Р-151), только за него можно взяться. -->
    <div
      class="divider"
      role="separator"
      aria-orientation={node.direction === 'row' ? 'vertical' : 'horizontal'}
      onpointerdown={onDividerDown}
      onpointermove={onDividerMove}
      onpointerup={onDividerUp}
      onpointercancel={onDividerUp}
      onlostpointercapture={finish}
    ></div>
    <div class="child second">
      <PaneTree node={node.second} />
    </div>
  </div>
{/if}

<style>
  .split {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .split.column {
    flex-direction: column;
  }

  .child {
    display: flex;
    /* Первый потомок держит долю, второй забирает остаток. Так доля из
       дерева ложится на экран без пересчёта в пиксели. */
    flex: 0 0 auto;
    min-width: 0;
    min-height: 0;
  }

  .child.second {
    flex: 1 1 0;
  }

  .divider {
    flex: none;
    /* Ширина зазора между панелями — и граница как раз в нём. */
    flex-basis: var(--zn-space-2);
    cursor: col-resize;
    transition: background-color var(--zn-motion-duration-fast) var(--zn-motion-easing);
  }

  .column > .divider {
    cursor: row-resize;
  }

  .divider:hover {
    background-color: var(--zn-color-bg-hover);
  }
</style>
