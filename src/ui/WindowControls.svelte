<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import Icon from './Icon.svelte';

  const appWindow = getCurrentWindow();

  let maximized = $state(false);
  let unlisten: UnlistenFn | null = null;

  async function refresh(): Promise<void> {
    maximized = await appWindow.isMaximized();
  }

  onMount(async () => {
    await refresh();
    // Развернуть окно можно и мимо наших кнопок: двойным щелчком по полосе
    // заголовка, прилипанием к краю экрана, сочетанием клавиш Windows.
    // Поэтому слушаем изменение размера, а не только свои нажатия.
    unlisten = await appWindow.onResized(() => {
      void refresh();
    });
  });

  onDestroy(() => {
    unlisten?.();
  });
</script>

<div class="controls">
  <button class="button" type="button" title="Свернуть" onclick={() => appWindow.minimize()}>
    <Icon name="window.minimize" />
  </button>
  <button
    class="button"
    type="button"
    title={maximized ? 'Восстановить' : 'Развернуть'}
    onclick={() => appWindow.toggleMaximize()}
  >
    <Icon name={maximized ? 'window.restore' : 'window.maximize'} />
  </button>
  <button
    class="button close"
    type="button"
    title="Закрыть"
    onclick={() => appWindow.close()}
  >
    <Icon name="window.close" />
  </button>
</div>

<style>
  .controls {
    display: flex;
    flex: none;
    align-self: stretch;
  }

  /* Глиф здесь мельче, чем везде: он рисуется в поле 10×10, как в Windows,
     и должен совпадать с кнопками системных окон, а не с нашими списками. */
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    --zn-control-icon-size: var(--zn-control-icon-size-window);
    width: var(--zn-control-window-button-width);
    padding: 0;
    border: none;
    background-color: transparent;
    color: var(--zn-color-fg-muted);
    cursor: default;
    transition: background-color var(--zn-motion-duration-fast) var(--zn-motion-easing);
  }

  .button:hover {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  .button:active {
    background-color: var(--zn-color-bg-active);
  }

  /* Красная подсветка кнопки закрытия — соглашение Windows.
     Токен danger, а не свой цвет: в другой теме он будет другим. */
  .close:hover {
    background-color: var(--zn-color-danger);
    color: var(--zn-color-fg-on-accent);
  }

  .close:active {
    background-color: var(--zn-color-danger);
    color: var(--zn-color-fg-on-accent);
  }
</style>
