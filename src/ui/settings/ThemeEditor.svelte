<script lang="ts">
  import Icon from '../Icon.svelte';
  import { openDropped } from '../../actions/files';
  import * as ipc from '../../ipc/appearance';
  import type { ThemeEditorState, TokenEntry } from '../../ipc/appearance';
  import { formatColor, parseColor, toHex, type Rgba } from '../../theme/color';
  import {
    cssPropertyOf,
    expandPalette,
    findingText,
    kindOf,
    PALETTE_LABELS,
    SECTIONS,
    splitLength,
    tokenNote,
  } from '../../theme/editor';
  import { appearance, refresh } from '../../theme/store.svelte';

  /**
   * Редактор темы (задача 105).
   *
   * Правит тему, которая на экране: так правка видна сразу на всём окне,
   * а не на образце. Все разделы токенов, а не только палитра (решение
   * владельца); палитра первой и раскрытой — из неё выводится всё прочее,
   * и человеку почти всегда хватает её одной. Разделы свёрнуты и рисуются
   * только раскрытыми: токенов полторы сотни.
   *
   * Встроенную тему не правим — она в двоичном файле приложения. Её
   * значения видны, поля заперты, и рядом — «создать свою на основе этой».
   *
   * Читаемость считает ядро теми же правилами, что тест встроенных тем
   * (`theme/readability.rs`): у своей темы раньше единственным судьёй
   * был глаз.
   */

  let { oncopy }: { oncopy: () => void } = $props();

  const look = $derived(appearance.current);
  let editor = $state<ThemeEditorState | null>(null);
  let problem = $state<string | null>(null);
  let open = $state<Record<string, boolean>>({});

  // Перечитываем на каждую смену оформления: правка файла темы — руками
  // или отсюда — приходит тем же событием, что смена темы.
  $effect(() => {
    const current = look;
    if (!current) return;
    void load(current.themeId, current.density);
  });

  async function load(id: string, density: ipc.Density): Promise<void> {
    try {
      const state = await ipc.themeEditor(id, density);
      // Ответ на прежнюю тему, пришедший после смены, не нужен.
      if (appearance.current?.themeId === id) editor = state;
    } catch (error) {
      editor = null;
      problem = String(error);
    }
  }

  const locked = $derived(editor === null || editor.builtin);

  /**
   * Записать значение. Окно перерисуется от слежения за папкой тем, но это
   * полсекунды; перечитываем сразу, как вкладка «Темы» при выборе темы.
   */
  async function write(section: string, key: string, value: string | null): Promise<void> {
    if (!editor || editor.builtin) return;
    problem = null;
    try {
      await ipc.setThemeValue(editor.id, section, key, value);
      await refresh();
    } catch (error) {
      // Правка, ломающая тему, отвергнута ядром — файл прежний. Сказать
      // почему, а поле вернуть к записанному.
      problem = String(error);
      if (look) void load(look.themeId, look.density);
    }
  }

  /**
   * Поймёт ли браузер значение — до записи, а не после (`cssPropertyOf`).
   * Ссылки на палитру подставляются: `{palette.accent}` — это цвет палитры.
   */
  function understood(section: string, key: string, value: string): boolean {
    const palette = Object.fromEntries((editor?.palette ?? []).map((entry) => [entry.key, entry.value]));
    const expanded = expandPalette(value, palette);
    // Ссылку на ключ, которого нет, отвергнет ядро и скажет словами.
    if (expanded === null) return true;
    return CSS.supports(cssPropertyOf(section, key), expanded);
  }

  /**
   * Текстовое поле: пустое — вернуть умолчание, прежнее — ничего не писать,
   * непонятное браузеру — не писать и сказать почему. Поле при отказе
   * возвращается к записанному: иначе на экране осталось бы значение,
   * которого нет в файле.
   */
  function commit(section: string, key: string, field: HTMLInputElement, was: string): void {
    const value = field.value.trim();
    if (value === was.trim()) return;
    if (value === '') {
      void write(section, key, null);
      return;
    }
    if (!understood(section, key, value)) {
      problem =
        cssPropertyOf(section, key) === 'color'
          ? `«${value}» — не цвет. Годится #rrggbb, rgba(…) или ссылка {palette.ключ}. Файл темы не изменён.`
          : `«${value}» оформление не поймёт. Файл темы не изменён.`;
      field.value = was;
      return;
    }
    void write(section, key, value);
  }

  /** Выбор цвета отдаёт `#rrggbb`; прозрачность прежнего цвета сохраняется. */
  function pick(section: string, key: string, hex: string, was: Rgba | null): void {
    const color = parseColor(hex);
    if (!color) return;
    void write(section, key, formatColor({ ...color, a: was?.a ?? 1 }));
  }

  function setAlpha(key: string, percent: string, was: Rgba): void {
    void write('palette', key, formatColor({ ...was, a: Number(percent) / 100 }));
  }

  function setLength(token: TokenEntry, text: string, unit: string): void {
    const amount = Number(text);
    if (text.trim() === '' || !Number.isFinite(amount)) return;
    const value = `${amount}${unit}`;
    if (value !== (token.own ?? token.default)) void write(token.section, token.key, value);
  }

  function tokensOf(section: string): TokenEntry[] {
    return editor?.tokens.filter((token) => token.section === section) ?? [];
  }

  const findings = $derived(editor?.findings ?? []);
</script>

{#if editor}
  <section class="editor">
    <div class="head">
      <h2 class="part-title">Редактор темы «{editor.name}»</h2>
      {#if !editor.builtin && editor.path}
        <button class="action" type="button" onclick={() => void openDropped([editor!.path!])}>
          Открыть файл темы
        </button>
      {/if}
    </div>

    {#if editor.builtin}
      <div class="locked">
        <p class="note">
          Встроенная тема живёт внутри приложения и не правится. Сделайте свою на её основе:
          копия сразу станет текущей и откроется здесь для правки.
        </p>
        <button class="action primary" type="button" onclick={oncopy}>
          Создать свою на основе «{editor.name}»
        </button>
      </div>
    {/if}

    {#if problem}
      <p class="broken"><Icon name="status.warning" /> {problem}</p>
    {/if}

    <!-- Читаемость — над палитрой: правят цвет и тут же смотрят, что вышло. -->
    <div class="check" class:bad={findings.length > 0 || editor.problem}>
      {#if editor.problem}
        <p class="check-title"><Icon name="status.warning" /> Тема не собирается: {editor.problem}</p>
      {:else if findings.length === 0}
        <p class="check-title">
          <Icon name="action.check" /> Читаемость: текст, акцент и подсветка проходят те же пороги,
          что встроенные темы.
        </p>
      {:else}
        <p class="check-title">
          <Icon name="status.warning" /> Читаемость — не проходит {findings.length}:
        </p>
        <ul class="findings">
          {#each findings as finding, index (index)}
            <li>{findingText(finding)}</li>
          {/each}
        </ul>
      {/if}
    </div>

    <h3 class="group-title">Палитра</h3>
    <div class="rows">
      {#each editor.palette as entry (entry.key)}
        {@const color = parseColor(entry.value)}
        <div class="row">
          <span class="swatch" style:--swatch={entry.value}></span>
          <div class="what">
            <span class="name">{PALETTE_LABELS[entry.key] ?? entry.key}</span>
            <span class="key">
              {entry.key}{entry.derived ? ' · выведен из фонов' : entry.own ? '' : ' · из встроенной'}
            </span>
          </div>
          <input
            class="field value"
            type="text"
            disabled={locked}
            value={entry.value}
            spellcheck="false"
            onchange={(e) => commit('palette', entry.key, e.currentTarget, entry.value)}
          />
          {#if color}
            <input
              class="picker"
              type="color"
              disabled={locked}
              value={toHex(color)}
              title="Выбрать цвет"
              onchange={(e) => pick('palette', entry.key, e.currentTarget.value, color)}
            />
          {:else}
            <span class="picker-gap"></span>
          {/if}
          <!-- Плотность — ползунком: выбор цвета системы её не умеет. Стоит
               у каждого цвета, а не только у полупрозрачных: найдено на живом
               окне — ползунок, дотянутый до ста, делал цвет непрозрачным
               и исчезал, и вернуть прозрачность было уже нечем. -->
          {#if color}
            <input
              class="alpha"
              type="range"
              min="0"
              max="100"
              disabled={locked}
              value={Math.round(color.a * 100)}
              title="Плотность {Math.round(color.a * 100)}%"
              onchange={(e) => setAlpha(entry.key, e.currentTarget.value, color)}
            />
          {:else}
            <span class="alpha-gap"></span>
          {/if}
          {#if entry.own && !locked}
            <button
              class="reset"
              type="button"
              title="Убрать из файла: значение возьмётся из встроенной темы"
              onclick={() => void write('palette', entry.key, null)}>вернуть</button
            >
          {:else}
            <span class="reset-gap"></span>
          {/if}
        </div>
      {/each}
    </div>

    <datalist id="zn-palette-refs">
      {#each editor.palette as entry (entry.key)}
        <option value={`{palette.${entry.key}}`}></option>
      {/each}
    </datalist>

    <h3 class="group-title">Остальные разделы</h3>
    <p class="note">
      Любой токен оформления по имени. Цвета ролей ссылаются на палитру — запись
      <code>{'{palette.accent}'}</code> берёт цвет оттуда и меняется вместе с ней.
    </p>

    {#each SECTIONS as section (section.id)}
      {@const list = tokensOf(section.id)}
      {@const own = list.filter((token) => token.own !== null).length}
      <div class="section">
        <button
          class="section-head"
          type="button"
          aria-expanded={open[section.id] ?? false}
          onclick={() => (open[section.id] = !(open[section.id] ?? false))}
        >
          <span class="chevron" class:expanded={open[section.id]}><Icon name="tree.chevron" /></span>
          <span class="section-title">{section.title}</span>
          <span class="count">[{section.id}] · {list.length}{own > 0 ? ` · своих ${own}` : ''}</span>
        </button>

        {#if open[section.id]}
          <div class="rows">
            {#each list as token (token.name)}
              {@const kind = kindOf(token.section, token.default)}
              {@const current = token.own ?? token.default}
              {@const length = kind === 'length' ? splitLength(current) : null}
              {@const color = kind === 'color' ? parseColor(token.resolved) : null}
              <div class="row">
                {#if kind === 'color'}
                  <span class="swatch" style:--swatch={token.resolved}></span>
                {/if}
                <div class="what">
                  <span class="name mono">{token.key}</span>
                  <!-- Вторая строка — то, чего не видно в поле: умолчание
                       у своего значения, итог у ссылки на палитру. -->
                  <span class="key">
                    {[
                      token.own !== null
                        ? `по умолчанию ${token.default}`
                        : token.resolved !== current
                          ? token.resolved
                          : '',
                      tokenNote(token.name) ?? '',
                    ]
                      .filter((part) => part !== '')
                      .join(' · ')}
                  </span>
                </div>
                {#if length}
                  <input
                    class="field amount"
                    type="number"
                    step="any"
                    disabled={locked}
                    value={length.amount}
                    onchange={(e) => setLength(token, e.currentTarget.value, length.unit)}
                  />
                  <span class="unit">{length.unit}</span>
                {:else}
                  <input
                    class="field value"
                    class:number={kind === 'number'}
                    type="text"
                    list={kind === 'color' ? 'zn-palette-refs' : undefined}
                    disabled={locked}
                    value={current}
                    spellcheck="false"
                    onchange={(e) => commit(token.section, token.key, e.currentTarget, current)}
                  />
                {/if}
                {#if color}
                  <input
                    class="picker"
                    type="color"
                    disabled={locked}
                    value={toHex(color)}
                    title="Выбрать цвет — вместо ссылки на палитру запишется сам цвет"
                    onchange={(e) => pick(token.section, token.key, e.currentTarget.value, color)}
                  />
                {/if}
                {#if token.own !== null && !locked}
                  <button
                    class="reset"
                    type="button"
                    title="Убрать из файла: вернётся умолчание"
                    onclick={() => void write(token.section, token.key, null)}>вернуть</button
                  >
                {:else}
                  <span class="reset-gap"></span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </section>
{/if}

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-3);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--zn-space-3);
  }

  .part-title {
    margin: 0;
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-ui);
    font-weight: var(--zn-font-weight-strong);
  }

  .group-title {
    margin: var(--zn-space-3) 0 0 0;
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
    font-weight: var(--zn-font-weight-strong);
    text-transform: uppercase;
    letter-spacing: var(--zn-font-letter-spacing-caps);
  }

  .note {
    margin: 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .note code {
    font-family: var(--zn-font-family-editor);
  }

  .locked {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--zn-space-3);
    padding: var(--zn-space-3) var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-lg);
    background-color: var(--zn-color-bg-surface);
  }

  .broken {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    margin: 0;
    padding: var(--zn-space-3) var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-warning);
    border-radius: var(--zn-radius-lg);
    color: var(--zn-color-warning);
  }

  .check {
    padding: var(--zn-space-3) var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-lg);
    color: var(--zn-color-success);
  }

  .check.bad {
    border-color: var(--zn-color-warning);
    color: var(--zn-color-warning);
  }

  .check-title {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    margin: 0;
  }

  /* Цветом внимания, а не основным текстом: список обязан читаться
     именно тогда, когда нечитаем основной текст, — найдено на живом окне. */
  .findings {
    margin: var(--zn-space-2) 0 0 0;
    padding-left: var(--zn-space-6);
    font-size: var(--zn-font-size-ui-small);
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
    min-height: var(--zn-control-row-height);
    padding-block: var(--zn-space-1);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  /* Образец цвета — квадрат цвета строки поверх рамки: цвет приходит
     свойством `--swatch`, потому что у каждой строки он свой. */
  .swatch {
    flex: none;
    width: var(--zn-control-icon-size-tile);
    height: var(--zn-control-icon-size-tile);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-sm);
    background-color: var(--swatch);
  }

  .what {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .name {
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-ui);
  }

  .mono,
  .key,
  .field,
  .unit {
    font-family: var(--zn-font-family-editor);
  }

  .key {
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .field {
    height: var(--zn-control-field-height);
    padding-inline: var(--zn-space-2);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-bg-canvas);
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-ui-small);
  }

  .field:focus {
    outline: none;
    border-color: var(--zn-color-border-focus);
  }

  .field:disabled {
    color: var(--zn-color-fg-muted);
  }

  .value {
    flex: 0 1 var(--zn-control-theme-card-width);
    min-width: 0;
  }

  .amount {
    flex: none;
    width: calc(var(--zn-space-6) * 3);
  }

  .unit {
    flex: none;
    width: var(--zn-space-6);
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .picker,
  .picker-gap {
    flex: none;
    width: var(--zn-control-field-height);
    height: var(--zn-control-field-height);
  }

  .picker {
    padding: 0;
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-bg-canvas);
    cursor: pointer;
  }

  .picker:disabled {
    cursor: default;
  }

  .alpha {
    accent-color: var(--zn-color-accent);
  }

  .alpha,
  .alpha-gap {
    flex: none;
    margin: 0;
    width: calc(var(--zn-space-6) * 3);
  }

  .reset,
  .reset-gap {
    flex: none;
    width: calc(var(--zn-space-6) * 3);
  }

  .reset {
    height: var(--zn-control-field-height);
    border: none;
    border-radius: var(--zn-radius-md);
    background: none;
    color: var(--zn-color-accent);
    font-family: inherit;
    font-size: var(--zn-font-size-ui-small);
    cursor: pointer;
  }

  .reset:hover {
    background-color: var(--zn-color-bg-hover);
  }

  .section {
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    width: 100%;
    height: var(--zn-control-row-height);
    padding: 0;
    border: none;
    background: none;
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    text-align: left;
    cursor: pointer;
  }

  .section-head:hover {
    color: var(--zn-color-accent);
  }

  /* Без перехода: единственная анимация — появление диалога и меню (Р-095). */
  .chevron {
    display: inline-flex;
    color: var(--zn-color-fg-subtle);
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .section-title {
    flex: 1;
  }

  .count {
    color: var(--zn-color-fg-subtle);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
  }

  .action {
    height: var(--zn-control-field-height);
    padding-inline: var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-bg-raised);
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    cursor: pointer;
  }

  .action:hover {
    background-color: var(--zn-color-bg-hover);
  }

  .action.primary {
    border-color: var(--zn-color-accent);
    background-color: var(--zn-color-accent);
    color: var(--zn-color-fg-on-accent);
  }

  .action.primary:hover {
    background-color: var(--zn-color-accent-hover);
  }
</style>
