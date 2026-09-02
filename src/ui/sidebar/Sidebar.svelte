<script lang="ts">
  import Icon from '../Icon.svelte';
  import FileTree from './FileTree.svelte';
  import ProjectSearch from './ProjectSearch.svelte';
  import Backlinks from './Backlinks.svelte';
  import { roots, setSidebarWidth } from '../../state/roots.svelte';
  import { addRootDialog } from '../../actions/project';
  import { noteStructureChange } from '../../state/persist.svelte';

  /**
   * Боковая панель. Что в ней показано, решает полоса значков рядом (Р-044).
   */

  interface Props {
    /** Панель поиска просит забрать фокус в поле ввода. */
    searchFocus?: number;
  }

  let { searchFocus = 0 }: Props = $props();

  let searchPanel: ReturnType<typeof ProjectSearch> | undefined = $state();

  $effect(() => {
    // Зависимость от счётчика, а не от факта: повторное нажатие Ctrl+Shift+F
    // при уже открытой панели тоже должно возвращать фокус в поле.
    void searchFocus;
    if (roots.panel === 'search') searchPanel?.focusField();
  });

  let panel: HTMLElement | undefined = $state();
  let dragging = $state(false);
  /** Ширина для доступности: реальная, а не «ноль значит из темы». */
  let width = $state(0);

  function limits(): { min: number; max: number } {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: number): number => {
      const parsed = Number.parseFloat(style.getPropertyValue(name));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    // Пределы — тоже токены: в компактной плотности они другие. Запасные
    // числа нужны на случай, если оформление ещё не применилось.
    return {
      min: read('--zn-control-sidebar-min-width', 160),
      max: read('--zn-control-sidebar-max-width', 640),
    };
  }

  const bounds = $derived.by(() => {
    void roots.sidebarWidth;
    return limits();
  });

  $effect(() => {
    void roots.sidebarWidth;
    width = Math.round(panel?.getBoundingClientRect().width ?? 0);
  });

  /**
   * Перетаскивание границы.
   *
   * Указатель захватывается на самой рукоятке: без этого быстрый рывок
   * уводит курсор за пределы элемента, и перетаскивание обрывается на середине.
   */
  function startDrag(event: PointerEvent): void {
    if (!panel) return;
    const handle = event.currentTarget as HTMLElement;
    const left = panel.getBoundingClientRect().left;
    const { min, max } = limits();

    handle.setPointerCapture(event.pointerId);
    dragging = true;

    const move = (e: PointerEvent): void => {
      const width = Math.round(Math.min(max, Math.max(min, e.clientX - left)));
      setSidebarWidth(width);
    };

    const finish = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      dragging = false;
      // Ширина — часть сессии: подогнав панель, пользователь не должен
      // обнаружить её прежней после перезапуска.
      noteStructureChange();
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  /** Клавиатурная подгонка: панель должна настраиваться и без мыши. */
  function nudge(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();

    const { min, max } = limits();
    const current = panel?.getBoundingClientRect().width ?? min;
    const step = event.shiftKey ? 40 : 8;
    const next = current + (event.key === 'ArrowRight' ? step : -step);

    setSidebarWidth(Math.round(Math.min(max, Math.max(min, next))));
    noteStructureChange();
  }
</script>

<aside
  class="sidebar"
  bind:this={panel}
  style:width={roots.sidebarWidth > 0 ? `${roots.sidebarWidth}px` : null}
>
  {#if roots.panel === 'search'}
    <ProjectSearch bind:this={searchPanel} />
  {:else if roots.panel === 'links'}
    <Backlinks />
  {:else}
    <header class="head">
      <span class="title">Папки</span>
      <button
        class="action"
        type="button"
        onclick={addRootDialog}
        title="Открыть папку (Ctrl+Shift+O)"
        aria-label="Открыть папку"
      >
        <Icon name="action.add-folder" />
      </button>
    </header>

    {#if roots.items.length === 0}
      <p class="empty">Папок нет</p>
      <p class="hint">Ctrl+Shift+O — открыть папку как проект</p>
    {:else}
      <FileTree />
    {/if}
  {/if}
</aside>

<!-- Рукоятка — отдельный элемент рядом с панелью, а не её граница: так она
     не съезжает вместе с содержимым и не мешает прокрутке дерева.

     Это разделитель с фокусом — по ARIA такой считается управляющим элементом
     («оконный разделитель»), и значения aria-value* здесь не украшение: без них
     экранный диктор не сможет сказать, что именно меняют стрелки.

     Предупреждения ниже сняты сознательно: проверяющий держит role="separator"
     в списке неинтерактивных ролей, но по спецификации разделитель с tabindex
     как раз интерактивен. Правильна разметка, а не список. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="handle"
  class:dragging
  role="separator"
  aria-orientation="vertical"
  aria-label="Ширина боковой панели"
  aria-valuenow={width}
  aria-valuemin={bounds.min}
  aria-valuemax={bounds.max}
  tabindex="0"
  onpointerdown={startDrag}
  onkeydown={nudge}
></div>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: var(--zn-control-sidebar-width);
    flex: none;
    min-height: 0;
    background-color: var(--zn-color-bg-surface);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    height: var(--zn-control-toolbar-height);
    flex: none;
    padding: 0 var(--zn-space-2) 0 var(--zn-space-4);
  }

  .title {
    flex: 1;
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
    font-weight: var(--zn-font-weight-strong);
    text-transform: uppercase;
    letter-spacing: var(--zn-font-letter-spacing-caps);
  }

  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--zn-control-row-height);
    height: var(--zn-control-row-height);
    padding: 0;
    border: none;
    border-radius: var(--zn-radius-sm);
    background: transparent;
    color: var(--zn-color-fg-muted);
    cursor: pointer;
  }

  .action:hover {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  .action:focus-visible {
    outline: var(--zn-border-width-thick) solid var(--zn-color-border-focus);
    outline-offset: calc(-1 * var(--zn-border-width-thick));
  }

  .empty,
  .hint {
    margin: 0;
    padding: var(--zn-space-2) var(--zn-space-4);
    color: var(--zn-color-fg-subtle);
  }

  .hint {
    padding-top: 0;
    font-size: var(--zn-font-size-ui-small);
  }

  /* Рукоятка шире видимой линии: попасть в границу толщиной в пиксель
     мышью нельзя, а расширять саму линию — значит рисовать полосу. */
  .handle {
    flex: none;
    width: var(--zn-space-3);
    margin-right: calc(-1 * var(--zn-space-3) + var(--zn-border-width));
    border-left: var(--zn-border-width) solid var(--zn-color-border-subtle);
    cursor: col-resize;
    z-index: var(--zn-z-panel);
  }

  .handle:hover,
  .handle.dragging,
  .handle:focus-visible {
    border-left-color: var(--zn-color-accent);
  }

  .handle:focus-visible {
    outline: none;
  }
</style>
