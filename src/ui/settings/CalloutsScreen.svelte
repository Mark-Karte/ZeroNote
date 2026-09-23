<script lang="ts">
  import Icon from '../Icon.svelte';
  import { iconNames, type IconName } from '../../icons/registry';
  import { COLOR_TOKENS, cssColorOf, iconOf, type CalloutDef } from '../../editor/callouts';
  import { callouts, removeCallout, saveCallout } from '../../state/callouts.svelte';
  import { put, settings } from '../../state/settings.svelte';
  import { askChoice } from '../../state/modal.svelte';
  import { appearance } from '../../theme/store.svelte';
  import { contrast, parseHex, TEXT_CONTRAST } from '../../theme/contrast';

  /**
   * Вкладка «Коллауты» (задача 103).
   *
   * Надстройка над `data/callouts.toml`, как всё окно параметров (Р-077):
   * правка уезжает в файл сразу, своего хранилища у вкладки нет. Файл
   * можно править и руками — список перечитается сам.
   */

  const file = $derived(callouts.state);
  const list = $derived(file?.callouts ?? []);
  const broken = $derived(file?.broken ?? null);
  const toolbar = $derived(settings.state?.settings.toolbar.items ?? []);

  /** Роли темы по-человечески. Порядок — как в образце: от частых к редким. */
  const ROLES: { id: string; name: string }[] = [
    { id: 'accent', name: 'Акцент' },
    { id: 'success', name: 'Успех' },
    { id: 'warning', name: 'Внимание' },
    { id: 'danger', name: 'Опасность' },
    { id: 'function', name: 'Цвет функций' },
    { id: 'keyword', name: 'Цвет ключевых слов' },
    { id: 'string', name: 'Цвет строк' },
    { id: 'number', name: 'Цвет чисел' },
    { id: 'type', name: 'Цвет типов' },
    { id: 'muted', name: 'Приглушённый' },
  ];

  function colorName(color: string): string {
    return ROLES.find((role) => role.id === color)?.name ?? color;
  }

  /**
   * Значки на выбор: все из реестра, кроме знака приложения и кнопок окна —
   * они принадлежат месту, а не смыслу. Значки коллаутов первыми.
   */
  const ICONS: IconName[] = (() => {
    const all = iconNames().filter(
      (name) => name !== 'app.mark' && !name.startsWith('window.') && !name.startsWith('tab.'),
    );
    const callout = all.filter((name) => name.startsWith('md.callout'));
    return [...callout, ...all.filter((name) => !name.startsWith('md.callout'))];
  })();

  /** Что правится сейчас. `original` — тип в файле; `null` — новый коллаут. */
  let editing = $state<{ original: string | null; draft: CalloutDef } | null>(null);

  function startNew(): void {
    editing = {
      original: null,
      draft: { id: '', title: '', icon: 'md.callout-note', color: 'accent' },
    };
  }

  function startEdit(callout: CalloutDef): void {
    editing = { original: callout.id, draft: { ...callout } };
  }

  async function save(): Promise<void> {
    if (!editing) return;
    if (await saveCallout(editing.original, editing.draft)) editing = null;
  }

  async function remove(callout: CalloutDef): Promise<void> {
    const answer = await askChoice(
      'Удалить коллаут?',
      `«${callout.title || callout.id}» уйдёт из списка. Заметки с [!${callout.id}] ` +
        'не изменятся — они будут рисоваться как [!note].',
      [
        { id: 'keep', label: 'Оставить', cancel: true, primary: true },
        { id: 'remove', label: 'Удалить', danger: true },
      ],
    );
    if (answer === 'remove') await removeCallout(callout.id);
  }

  function onToolbar(id: string): boolean {
    return toolbar.includes(`callout:${id}`);
  }

  /** Поставить на панель — в конец состава; второе нажатие убирает. */
  function toggleToolbar(id: string): void {
    const item = `callout:${id}`;
    const next = onToolbar(id) ? toolbar.filter((known) => known !== item) : [...toolbar, item];
    void put(['toolbar', 'items'], next);
  }

  /**
   * Читается ли свой цвет подписью на фоне карточки — в теме, которая
   * сейчас на экране. У роли темы судья уже был: её проверяет тест
   * читаемости тем (Р-143).
   */
  const readability = $derived.by(() => {
    const color = editing?.draft.color ?? '';
    if (!parseHex(color)) return null;
    const tokens = appearance.current?.tokens ?? {};
    const grounds = [tokens['color-bg-raised'], tokens['color-bg-canvas']].filter(
      (ground): ground is string => typeof ground === 'string',
    );
    const ratios = grounds
      .map((ground) => contrast(color, ground))
      .filter((ratio): ratio is number => ratio !== null);
    return ratios.length > 0 ? Math.min(...ratios) : null;
  });

  const customColor = $derived(
    editing !== null && !Object.hasOwn(COLOR_TOKENS, editing.draft.color),
  );
</script>

{#if broken}
  <p class="broken">
    <Icon name="status.warning" />
    {broken}
  </p>
{:else}
  {#if file && file.problems.length > 0}
    <div class="broken problems">
      <Icon name="status.warning" />
      <div>
        <p class="lead">Из callouts.toml применилось не всё, остальное работает:</p>
        <ul>
          {#each file.problems as problem (problem)}
            <li>{problem}</li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
  {#if callouts.problem}
    <p class="broken">
      <Icon name="status.warning" />
      {callouts.problem}
    </p>
  {/if}
{/if}

<p class="note intro">
  Коллаут — цитата, первая строка которой написана так: <code>&gt; [!тип] Подпись</code>.
  Obsidian рисует её карточкой, ZeroNote тоже. Подпись — текст заметки: её пишет вставка,
  и её увидит Obsidian. Тип, которого нет в списке, рисуется как <code>note</code>.
</p>

{#if editing}
  {@const draft = editing.draft}
  <div class="editor">
    <!-- Образец — так карточка выглядит в заметке, в теме, которая сейчас
         на экране. Своему цвету другого судьи нет. -->
    <div class="sample" style:--callout-color={cssColorOf(draft.color)}>
      <span class="sample-icon"><Icon name={iconOf(draft.icon)} /></span>
      <span class="sample-title">{draft.title || draft.id || 'Коллаут'}</span>
    </div>

    <div class="field">
      <label class="name" for="callout-id">Тип</label>
      <input
        id="callout-id"
        class="control"
        type="text"
        bind:value={draft.id}
        placeholder="tip"
        spellcheck="false"
      />
      <span class="note">Как пишется в заметке: <code>[!{draft.id || 'тип'}]</code>. Без пробелов.</span>
    </div>

    <div class="field">
      <label class="name" for="callout-title">Подпись</label>
      <input
        id="callout-title"
        class="control"
        type="text"
        bind:value={draft.title}
        placeholder="Совет"
      />
      <span class="note">Вставка пишет её после типа. Пусто — только тип.</span>
    </div>

    <div class="field">
      <span class="name">Цвет</span>
      <div class="swatches">
        {#each ROLES as role (role.id)}
          <button
            class="swatch"
            class:current={draft.color === role.id}
            type="button"
            title={role.name}
            aria-label={role.name}
            style:background-color={cssColorOf(role.id)}
            onclick={() => (draft.color = role.id)}
          ></button>
        {/each}
        <label class="own" class:current={customColor} title="Свой цвет">
          <input
            type="color"
            value={parseHex(draft.color) ? draft.color : '#888888'}
            oninput={(e) => (draft.color = e.currentTarget.value)}
          />
          Свой
        </label>
      </div>
      <span class="note">
        {#if customColor}
          {draft.color} — свой цвет не меняется вместе с темой.
          {#if readability !== null}
            Контраст с фоном карточки {readability.toFixed(1).replace('.', ',')}:1{readability <
            TEXT_CONTRAST
              ? ' — ниже 4,5:1, подпись будет читаться плохо'
              : ''}.
          {/if}
        {:else}
          {colorName(draft.color)} — цвет темы: меняется вместе с ней, читаемость проверена.
        {/if}
      </span>
    </div>

    <div class="field">
      <span class="name">Значок</span>
      <div class="icons">
        {#each ICONS as name (name)}
          <button
            class="pick"
            class:current={draft.icon === name}
            type="button"
            title={name}
            aria-label={name}
            onclick={() => (draft.icon = name)}
          >
            <Icon {name} />
          </button>
        {/each}
      </div>
    </div>

    <div class="actions">
      <button class="button" type="button" onclick={() => (editing = null)}>Отмена</button>
      <button class="button primary" type="button" disabled={broken !== null} onclick={() => void save()}>
        Сохранить
      </button>
    </div>
  </div>
{:else}
  <div class="section">
    <h3 class="heading">Коллауты · {list.length}</h3>
    <button class="button" type="button" disabled={broken !== null} onclick={startNew}>
      Добавить коллаут
    </button>
  </div>
{/if}

<div class="list">
  {#each list as callout (callout.id)}
    <div class="item" style:--callout-color={cssColorOf(callout.color)}>
      <span class="glyph"><Icon name={iconOf(callout.icon)} /></span>
      <div class="what">
        <span class="name">{callout.title || callout.id}</span>
        <span class="note">[!{callout.id}] · {colorName(callout.color)}</span>
      </div>
      <button class="button" type="button" onclick={() => toggleToolbar(callout.id)}>
        {onToolbar(callout.id) ? 'Убрать с панели' : 'На панель'}
      </button>
      <button class="button" type="button" disabled={broken !== null} onclick={() => startEdit(callout)}>
        Изменить
      </button>
      <button
        class="step"
        type="button"
        disabled={broken !== null}
        title="Удалить"
        aria-label="Удалить"
        onclick={() => void remove(callout)}
      >
        <Icon name="action.remove" />
      </button>
    </div>
  {/each}
</div>

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

  .problems {
    align-items: flex-start;
  }

  .problems ul {
    margin: var(--zn-space-1) 0 0 0;
    padding-left: var(--zn-space-5);
  }

  .lead {
    margin: 0;
  }

  .intro {
    margin: 0 0 var(--zn-space-4) 0;
    line-height: var(--zn-font-line-height-ui);
  }

  code {
    font-family: var(--zn-font-family-editor);
  }

  .note {
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .name {
    color: var(--zn-color-fg-default);
  }

  .section {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
    margin-bottom: var(--zn-space-3);
  }

  .heading {
    flex: 1;
    margin: 0;
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-ui);
    font-weight: var(--zn-font-weight-strong);
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-4);
    margin-bottom: var(--zn-space-5);
    padding: var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-lg);
    background-color: var(--zn-color-bg-surface);
  }

  /* Образец карточки — тем же рисунком, что в заметке: черта, значок
     и подпись цветом коллаута, подложка утопленного блока (Р-179). */
  .sample {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    padding: var(--zn-space-3);
    border-radius: var(--zn-radius-md);
    box-shadow: inset var(--zn-border-width-thick) 0 0 var(--callout-color);
    background-color: var(--zn-color-bg-block);
    color: var(--callout-color);
    font-weight: var(--zn-font-weight-strong);
  }

  .sample-icon {
    display: inline-flex;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-2);
  }

  .control {
    height: var(--zn-control-field-height);
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

  .swatches {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--zn-space-2);
  }

  .swatch {
    width: var(--zn-control-toolbar-button-size);
    height: var(--zn-control-toolbar-button-size);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-md);
    cursor: default;
  }

  .swatch.current,
  .own.current,
  .pick.current {
    box-shadow: 0 0 0 var(--zn-border-width-thick) var(--zn-color-border-focus);
  }

  .own {
    display: inline-flex;
    align-items: center;
    gap: var(--zn-space-2);
    height: var(--zn-control-toolbar-button-size);
    padding-inline: var(--zn-space-2);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-md);
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
  }

  .own input {
    width: var(--zn-control-icon-size-tile);
    height: var(--zn-control-icon-size-tile);
    padding: 0;
    border: none;
    background: none;
  }

  /* Сетка без прокрутки: значков около ста двадцати, это шесть рядов,
     и выбирать глазами проще, когда видно все сразу. */
  .icons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--zn-space-1);
  }

  .pick {
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

  .pick:hover {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
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

  .glyph {
    display: inline-flex;
    flex: none;
    justify-content: center;
    width: var(--zn-control-toolbar-button-size);
    color: var(--callout-color);
  }

  .what {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: var(--zn-space-1);
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

  .primary {
    border-color: var(--zn-color-accent);
    background-color: var(--zn-color-accent);
    color: var(--zn-color-fg-on-accent);
  }

  .primary:hover:not(:disabled) {
    border-color: var(--zn-color-accent-hover);
    background-color: var(--zn-color-accent-hover);
  }
</style>
