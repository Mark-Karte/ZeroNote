<script lang="ts">
  import Icon from '../Icon.svelte';
  import { iconForCommand } from '../../icons/commands';
  import { commandList } from '../../keymap/global.svelte';
  import { put, settings } from '../../state/settings.svelte';
  import { CALLOUT_PREFIX, textLabelOf } from '../toolbar';
  import { calloutById } from '../../state/callouts.svelte';
  import { cssColorOf, iconOf } from '../../editor/callouts';
  import { t } from '../../l10n';

  /**
   * Вкладка «Панель инструментов» (задача 102).
   *
   * Надстройка над разделом `[toolbar]` файла настроек, как и всё окно
   * параметров (Р-077): состав — список в файле, и каждое изменение здесь
   * уезжает туда же сразу. Своего хранилища нет.
   *
   * Порядок меняется стрелками, а не перетаскиванием: перетаскивание есть
   * у вкладок и в дереве, но у списка из трёх десятков строк оно труднее
   * попадания в стрелку, а сделать его стоит отдельно, если стрелками
   * окажется неудобно.
   */

  const values = $derived(settings.state?.settings);
  const broken = $derived(settings.state?.broken ?? null);
  const items = $derived(values?.toolbar.items ?? []);

  const commands = $derived(commandList());
  const titles = $derived(new Map(commands.map((command) => [command.id, command.title])));

  /** Служебные слова по-человечески. */
  const WORDS: Record<string, { title: string; note: string }> = {
    separator: { title: t('toolbar.separator'), note: t('toolbar.separator.note') },
    spacer: { title: t('toolbar.spacer'), note: t('toolbar.spacer.note') },
    path: { title: t('toolbar.path'), note: t('toolbar.path.note') },
  };

  /** Коллаут на панели — `callout:тип` (задача 103). */
  function calloutOf(item: string) {
    return item.startsWith(CALLOUT_PREFIX) ? calloutById(item.slice(CALLOUT_PREFIX.length)) : null;
  }

  function titleOf(item: string): string {
    if (item.startsWith(CALLOUT_PREFIX)) {
      const callout = calloutOf(item);
      return callout
        ? t('toolbar.callout', { callout: callout.title || callout.id })
        : t('toolbar.callout.missing');
    }
    return WORDS[item]?.title ?? titles.get(item) ?? item;
  }

  function noteOf(item: string): string {
    if (item.startsWith(CALLOUT_PREFIX) && !calloutOf(item)) {
      // Кнопку несуществующего коллаута панель не рисует — здесь её видно,
      // чтобы было что убрать.
      return t('toolbar.callout.removed', { item });
    }
    return WORDS[item]?.note ?? item;
  }

  let filter = $state('');

  const found = $derived(
    commands.filter((command) => {
      const needle = filter.trim().toLowerCase();
      if (needle === '') return true;
      return (
        command.title.toLowerCase().includes(needle) || command.id.toLowerCase().includes(needle)
      );
    }),
  );

  /** Записать состав целиком: список в файле меняется одной правкой. */
  function write(next: string[]): void {
    void put(['toolbar', 'items'], next);
  }

  function move(index: number, delta: number): void {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    write(next);
  }

  function remove(index: number): void {
    write(items.filter((_, place) => place !== index));
  }

  function add(item: string): void {
    write([...items, item]);
  }

  /** Убрать ключ — значит вернуть набор по умолчанию: его знает ядро. */
  function reset(): void {
    void put(['toolbar', 'items'], null);
  }
</script>

{#if broken}
  <p class="broken">
    <Icon name="status.warning" />
    {broken}
  </p>
{:else if settings.problem}
  <!-- Отказ записи виден здесь же, а не только на вкладке «Настройки»:
       иначе стрелка, которая ничего не переставила, выглядела бы поломкой. -->
  <p class="broken">
    <Icon name="status.warning" />
    {settings.problem}
  </p>
{/if}

{#if values}
  <div class="rows">
    <div class="row">
      <div class="what">
        <span class="name">{t('toolbar.show')}</span>
        <span class="note">{t('toolbar.show.note')}</span>
      </div>
      <select
        class="control"
        disabled={broken !== null}
        value={values.toolbar.show}
        onchange={(e) => put(['toolbar', 'show'], e.currentTarget.value)}
      >
        <option value="always">{t('toolbar.show.always')}</option>
        <option value="text">{t('toolbar.show.text')}</option>
        <option value="markdown">{t('toolbar.show.markdown')}</option>
        <option value="never">{t('toolbar.show.never')}</option>
      </select>
    </div>

    <div class="row">
      <div class="what">
        <span class="name">{t('toolbar.width')}</span>
        <span class="note">{t('toolbar.width.note')}</span>
      </div>
      <select
        class="control"
        disabled={broken !== null}
        value={values.toolbar.width}
        onchange={(e) => put(['toolbar', 'width'], e.currentTarget.value)}
      >
        <option value="column">{t('toolbar.width.column')}</option>
        <option value="full">{t('toolbar.width.full')}</option>
      </select>
    </div>

    <div class="row">
      <div class="what">
        <span class="name">{t('toolbar.size')}</span>
      </div>
      <select
        class="control"
        disabled={broken !== null}
        value={values.toolbar.size}
        onchange={(e) => put(['toolbar', 'size'], e.currentTarget.value)}
      >
        <option value="small">{t('toolbar.size.small')}</option>
        <option value="normal">{t('toolbar.size.normal')}</option>
        <option value="large">{t('toolbar.size.large')}</option>
      </select>
    </div>
  </div>

  <div class="section">
    <h3 class="heading">{t('toolbar.items')}</h3>
    <button class="button" type="button" disabled={broken !== null} onclick={reset}>
      {t('toolbar.reset')}
    </button>
  </div>

  {#if items.length === 0}
    <p class="note lead">{t('toolbar.empty')}</p>
  {:else}
    <div class="list">
      {#each items as item, index (index)}
        <div class="item">
          <span class="glyph">
            {#if item === 'separator'}
              <span class="rule"></span>
            {:else if item === 'spacer'}
              <span class="gap"></span>
            {:else if item === 'path'}
              <Icon name="file.text" />
            {:else if calloutOf(item)}
              <span style:color={cssColorOf(calloutOf(item)!.color)}>
                <Icon name={iconOf(calloutOf(item)!.icon)} />
              </span>
            {:else if textLabelOf(item)}
              <span class="label">{textLabelOf(item)}</span>
            {:else if iconForCommand(item)}
              <Icon name={iconForCommand(item)!} />
            {/if}
          </span>
          <div class="what">
            <span class="name">{titleOf(item)}</span>
            <span class="note">{noteOf(item)}</span>
          </div>
          <button
            class="step"
            type="button"
            disabled={broken !== null || index === 0}
            title={t('toolbar.up')}
            aria-label={t('toolbar.up')}
            onclick={() => move(index, -1)}
          >
            <Icon name="cmd.move-line-up" />
          </button>
          <button
            class="step"
            type="button"
            disabled={broken !== null || index === items.length - 1}
            title={t('toolbar.down')}
            aria-label={t('toolbar.down')}
            onclick={() => move(index, 1)}
          >
            <Icon name="cmd.move-line-down" />
          </button>
          <button
            class="step"
            type="button"
            disabled={broken !== null}
            title={t('toolbar.remove')}
            aria-label={t('toolbar.remove')}
            onclick={() => remove(index)}
          >
            <Icon name="action.remove" />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="section">
    <h3 class="heading">{t('toolbar.add')}</h3>
    <div class="words">
      <button class="button" type="button" disabled={broken !== null} onclick={() => add('separator')}>
        {t('toolbar.separator')}
      </button>
      <button class="button" type="button" disabled={broken !== null} onclick={() => add('spacer')}>
        {t('toolbar.spacer')}
      </button>
      <button
        class="button"
        type="button"
        disabled={broken !== null || items.includes('path')}
        onclick={() => add('path')}
      >
        {t('toolbar.path')}
      </button>
    </div>
  </div>

  <input
    class="control search"
    type="text"
    bind:value={filter}
    placeholder={t('toolbar.search')}
    aria-label={t('keys.search.label')}
    spellcheck="false"
  />

  <div class="list">
    {#each found as command (command.id)}
      <div class="item">
        <span class="glyph">
          {#if textLabelOf(command.id)}
            <span class="label">{textLabelOf(command.id)}</span>
          {:else if iconForCommand(command.id)}
            <Icon name={iconForCommand(command.id)!} />
          {/if}
        </span>
        <div class="what">
          <span class="name">{command.title}</span>
          <span class="note">{command.id}</span>
        </div>
        {#if items.includes(command.id)}
          <span class="note">{t('toolbar.added')}</span>
        {:else}
          <button
            class="button"
            type="button"
            disabled={broken !== null}
            onclick={() => add(command.id)}
          >
            {t('toolbar.add.button')}
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .broken {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    margin: 0 0 var(--zn-space-5) 0;
    padding: var(--zn-space-3) var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-warning);
    border-radius: var(--zn-radius-lg);
    color: var(--zn-color-warning);
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-5);
    padding-block: var(--zn-space-4);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .what {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: var(--zn-space-1);
  }

  .name {
    color: var(--zn-color-fg-default);
  }

  .note {
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .lead {
    margin: 0 0 var(--zn-space-4) 0;
  }

  .control {
    flex: none;
    height: var(--zn-control-field-height);
    min-width: var(--zn-control-popup-min-width);
    padding-inline: var(--zn-space-3);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-bg-canvas);
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
  }

  .control:focus-visible {
    outline: none;
    border-color: var(--zn-color-border-focus);
  }

  .control:disabled {
    color: var(--zn-color-fg-subtle);
  }

  .search {
    width: 100%;
    margin-bottom: var(--zn-space-3);
  }

  .section {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
    margin: var(--zn-space-6) 0 var(--zn-space-3) 0;
  }

  .heading {
    flex: 1;
    margin: 0;
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-ui);
    font-weight: var(--zn-font-weight-strong);
  }

  .words {
    display: flex;
    gap: var(--zn-space-2);
  }

  .list {
    display: flex;
    flex-direction: column;
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
    padding-block: var(--zn-space-2);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  /* Значок занимает место всегда, даже пустой: строки не должны разъезжаться. */
  .glyph {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--zn-control-toolbar-button-size);
    color: var(--zn-color-fg-muted);
  }

  .label {
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
  }

  /* Черта рисуется так же, как на самой панели. */
  .rule {
    width: var(--zn-border-width);
    height: var(--zn-control-icon-size);
    background-color: var(--zn-color-border-default);
  }

  .gap {
    width: var(--zn-control-icon-size);
    height: var(--zn-control-icon-size);
    border: var(--zn-border-width) dashed var(--zn-color-border-default);
    border-radius: var(--zn-radius-sm);
  }

  .step {
    display: inline-flex;
    flex: none;
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

  .step:disabled {
    color: var(--zn-color-fg-subtle);
  }

  .button {
    flex: none;
    height: var(--zn-control-field-height);
    padding-inline: var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-lg);
    background-color: transparent;
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    cursor: default;
  }

  .button:hover:not(:disabled) {
    background-color: var(--zn-color-bg-hover);
  }

  .button:disabled {
    color: var(--zn-color-fg-subtle);
  }
</style>
