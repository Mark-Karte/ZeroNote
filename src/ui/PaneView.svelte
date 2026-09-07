<script lang="ts">
  import TabStrip from './TabStrip.svelte';
  import EditorHost from './EditorHost.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import MarkdownBar from './MarkdownBar.svelte';
  import SettingsScreen from './settings/SettingsScreen.svelte';
  import ImageView from './ImageView.svelte';
  import type { PaneNode } from '../ipc/layout';
  import { layout, setActivePane } from '../state/panes.svelte';
  import { tabById, languageOf } from '../state/tabs.svelte';
  import { markdownBarEnabled } from '../state/settings.svelte';
  import { dropTarget } from '../state/tab-drag.svelte';

  /**
   * Одна область редактора (Р-210): своя полоса вкладок, своё содержимое.
   *
   * Что показывать, решает вид активной вкладки **этой** области, а не окна.
   * На область — полоса вкладок и панель разметки; на окно — строка
   * состояния, шапка, боковая полоса, и они смотрят на активную область.
   */
  let { pane }: { pane: PaneNode } = $props();

  const focused = $derived(layout.activePane === pane.id);
  const tab = $derived(pane.active === null ? null : tabById(pane.active));
  const kind = $derived(tab?.meta.kind ?? 'text');

  /**
   * Панель разметки — только над markdown и только если её не убрали
   * настройкой. Язык берётся у вкладки: его меняют руками в строке
   * состояния, и панель обязана следовать за выбором.
   */
  const showMarkdownBar = $derived(
    markdownBarEnabled() && tab !== null && languageOf(tab)?.id === 'markdown',
  );

  /**
   * Фокус назначает щелчок, и только он (Р-210).
   *
   * На стадии захвата, до всех обработчиков внутри: кнопка панели разметки
   * гасит `mousedown`, чтобы не отнимать фокус у редактора, и команда
   * выполнилась бы над областью, которая была активной до щелчка.
   */
  function onPointerDown(): void {
    if (layout.activePane !== pane.id) setActivePane(pane.id);
  }

  /**
   * Куда встанет вкладка, которую сюда тащат (задача 77): половина области
   * у края — разделение, вся область — перенос. Полосу подсвечивает она сама.
   */
  const drop = $derived.by(() => {
    const target = dropTarget.value;
    if (!target || target.pane !== pane.id || target.zone === 'strip') return null;
    return target.zone;
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pane panel" class:focused data-pane-id={pane.id} onpointerdowncapture={onPointerDown}>
  <TabStrip {pane} {focused} />

  {#if kind === 'settings'}
    <!-- Параметры — вкладка, а не режим окна (Р-185). -->
    <SettingsScreen />
  {:else if kind === 'image'}
    <ImageView pane={pane.id} />
  {:else if kind === 'pdf'}
    <!-- Показ грузится по требованию: pdf.js — самая большая зависимость
         проекта, и обычным импортом он попадал бы в путь запуска. -->
    {#await import('./PdfView.svelte') then module}
      {@const PdfView = module.default}
      <PdfView pane={pane.id} />
    {/await}
  {:else}
    <!-- Панель поиска одна на окно и стоит над активной областью:
         поиск идёт по тому, что под фокусом. -->
    {#if focused}
      <SearchPanel />
    {/if}
    {#if showMarkdownBar}
      <MarkdownBar />
    {/if}
    <EditorHost pane={pane.id} />
  {/if}

  {#if drop}
    <div class="drop {drop}"></div>
  {/if}
</div>

<style>
  .pane {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    /* Рабочая область — самый ближний слой: панели стоят на подложке,
       а она лежит на панели. */
    background-color: var(--zn-color-bg-raised);
  }

  /* Подсветка сброса — цветом выделения: та же роль «здесь окажется»,
     что у выделенного текста, и та же прозрачность поверх содержимого. */
  .drop {
    position: absolute;
    inset: 0;
    z-index: var(--zn-z-overlay);
    background-color: var(--zn-color-bg-selection);
    pointer-events: none;
  }

  .drop.left {
    inset-inline-end: 50%;
  }

  .drop.right {
    inset-inline-start: 50%;
  }

  .drop.top {
    inset-block-end: 50%;
  }

  .drop.bottom {
    inset-block-start: 50%;
  }
</style>
