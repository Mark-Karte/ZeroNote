<script lang="ts">
  import Icon from './Icon.svelte';
  import WindowControls from './WindowControls.svelte';
  import { crumbsFor } from './crumbs';
  import { activeTab } from '../state/tabs.svelte';
  import { roots } from '../state/roots.svelte';
  import { quickOpen } from '../actions/project';
  import { goBack, goForward } from '../actions/navigate';
  import { canGoBack, canGoForward } from '../state/history.svelte';
  import { commandList } from '../keymap/global.svelte';
  import { labelOf } from '../keymap/binding';

  const tab = $derived(activeTab());

  /**
   * Путь активного файла крошками. Имя файла и точка правок остались
   * на вкладке: повторять их в шапке незачем, а путь на вкладку не влезает.
   */
  const crumbs = $derived(crumbsFor(tab?.meta.path ?? null, roots.items));

  /** Полный путь — подсказкой: крошки показывают не всё. */
  const fullPath = $derived(tab?.meta.path ?? '');

  /**
   * Кнопки истории мест (задача 85).
   *
   * Гаснут, а не исчезают (Р-189): пропадающая кнопка сдвигает соседние,
   * и человек попадает не туда, куда целился. Подпись сочетания берётся
   * из раскладки — сочетание переназначаемо, а подсказка врать не должна.
   */
  const commands = $derived(commandList());

  function hint(id: string, fallback: string): string {
    const found = commands.find((command) => command.id === id);
    if (!found) return fallback;
    return found.binding ? `${found.title} · ${labelOf(found.binding)}` : found.title;
  }

  const back = $derived({ can: canGoBack(), hint: hint('view.back', 'Назад') });
  const forward = $derived({ can: canGoForward(), hint: hint('view.forward', 'Вперёд') });
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

  <div class="history">
    <button
      class="step"
      type="button"
      disabled={!back.can}
      onclick={goBack}
      title={back.hint}
      aria-label="Назад по местам курсора"
    >
      <Icon name="cmd.back" />
    </button>
    <button
      class="step"
      type="button"
      disabled={!forward.can}
      onclick={goForward}
      title={forward.hint}
      aria-label="Вперёд по местам курсора"
    >
      <Icon name="cmd.forward" />
    </button>
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

  /* Знак ложится прямо на шапку: подложка нужна плитке в панели задач,
     а здесь фон наш (Р-097). Кольцо берёт цвет текста, штрих внутри —
     акцент, и оба меняются вместе с темой. */
  .mark {
    display: inline-flex;
    --zn-control-icon-size: var(--zn-control-icon-size-mark);
    color: var(--zn-color-fg-default);
  }

  .name {
    color: var(--zn-color-fg-default);
    font-weight: var(--zn-font-weight-strong);
  }

  /* Стрелки стоят слева от крошек: они про путь, которым сюда пришли,
     а крошки — про то, где мы сейчас. */
  .history {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--zn-space-1);
  }

  .step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--zn-control-toolbar-button-size);
    height: var(--zn-control-toolbar-button-size);
    border: none;
    border-radius: var(--zn-radius-md);
    background: none;
    color: var(--zn-color-fg-muted);
    cursor: default;
  }

  .step:hover:not(:disabled) {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  /* Недоступная кнопка гаснет цветом, а не прозрачностью: прозрачность
     смешала бы её с подложкой, а у нас три разных фона (Р-083). */
  .step:disabled {
    color: var(--zn-color-fg-subtle);
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
