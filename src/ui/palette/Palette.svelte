<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../Icon.svelte';
  import { iconForFile, kindOf } from '../../icons/files';
  import { iconForCommand } from '../../icons/commands';
  import { palette, refresh, close, move, accept, mode } from '../../state/palette.svelte';
  import { roots } from '../../state/roots.svelte';
  import { matchRange, placeholderFor, parse } from './query';
  import { labelOf } from '../../keymap/binding';

  /**
   * Палитра: одно поле, три режима по префиксу (Р-076).
   *
   * Список не виртуализуется намеренно: показывается полсотни строк, и
   * распорка с окном тут стоила бы больше, чем экономила.
   */

  let field: HTMLInputElement | undefined = $state();

  const current = $derived(mode());

  /**
   * Забрать фокус и выделить запрос — но только в момент открытия.
   *
   * Зависимость единственная: счётчик открытий. Читать здесь `palette.query`
   * нельзя ни в коем случае — эффект перезапускался бы на каждую букву
   * и выделял её же, так что следующая буква её заменяла бы. Набрать больше
   * одного символа стало бы невозможно.
   *
   * Выделяется набранное, но НЕ знак режима. Память о прошлом запросе нужна,
   * когда промахнулся мимо строки и открываешь снова; выделение нужно, чтобы
   * набор заменял прошлое, а не дописывался к нему. А знак режима в выделение
   * попадать не должен: первая же буква стёрла бы `>` и уронила палитру
   * обратно в поиск файлов.
   */
  $effect(() => {
    if (palette.opens === 0 || !palette.open) return;

    untrack(() => {
      field?.focus();
      const raw = palette.query;
      const start = raw.length - parse(raw).term.length;
      field?.setSelectionRange(start, raw.length);
    });
  });

  /** Имя, разрезанное на совпавшие и обычные куски — для подсветки. */
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

  /** То же для команд и тегов: там совпадение — один непрерывный кусок. */
  function split(text: string, term: string): { text: string; hit: boolean }[] {
    const range = matchRange(text, term);
    if (!range) return [{ text, hit: false }];

    const [at, length] = range;
    return [
      { text: text.slice(0, at), hit: false },
      { text: text.slice(at, at + length), hit: true },
      { text: text.slice(at + length), hit: false },
    ].filter((piece) => piece.text !== '');
  }

  /** Запрос без префикса режима — по нему подсвечиваются совпадения. */
  const term = $derived(
    current === 'files' ? palette.query : palette.query.replace(/^\s*[>#]\s*/, ''),
  );

  /** Путь без имени файла и без пути корня: показываем, где файл лежит. */
  function place(path: string, rootId: number): string {
    const root = roots.items.find((r) => r.id === rootId);
    const cut = root ? path.slice(root.path.length).replace(/^[\\/]/, '') : path;
    const parts = cut.split(/[\\/]/);
    parts.pop();

    const inside = parts.join(' / ');
    // Имя корня показываем, только когда корней несколько: иначе оно
    // повторяется в каждой строке и не несёт ничего.
    if (roots.items.length > 1 && root) {
      return inside === '' ? root.name : `${root.name} / ${inside}`;
    }
    return inside;
  }

  const EMPTY: Record<string, string> = {
    files: 'Ничего не найдено',
    commands: 'Нет такой команды',
    tags: 'Нет такого тега',
  };

  const NOTHING_YET: Record<string, string> = {
    files: 'В индексе пока нет файлов',
    commands: 'Команд нет',
    tags: 'В проекте нет тегов',
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void accept();
    }
  }
</script>

{#if palette.open}
  <!-- Подложка перехватывает нажатия мимо палитры. Роль presentation:
       закрытие по щелчку мимо — удобство, а не единственный способ уйти;
       для клавиатуры есть Escape. -->
  <div
    class="backdrop"
    role="presentation"
    onpointerdown={(event) => {
      if (event.target === event.currentTarget) close();
    }}
  >
    <div class="palette">
      <div class="head">
        <!-- Подпись режима, а не тот же знак ещё раз: знак пользователь
             и так видит в поле — он его только что набрал. -->
        {#if current !== 'files'}
          <span class="mode">{current === 'commands' ? 'Команды' : 'Теги'}</span>
        {/if}
        <input
          class="field"
          type="text"
          bind:this={field}
          bind:value={palette.query}
          oninput={() => void refresh()}
          onkeydown={onKeyDown}
          placeholder={placeholderFor(current)}
          aria-label="Палитра: файл, команда или тег"
          spellcheck="false"
        />
        <kbd class="hint">esc</kbd>
      </div>

      {#if palette.items.length === 0}
        <p class="empty">{term === '' ? NOTHING_YET[current] : EMPTY[current]}</p>
      {:else}
        <ul class="list">
          {#each palette.items as item, i (item.kind === 'file' ? item.hit.path : item.kind === 'command' ? item.id : item.tag)}
            <li>
              <button
                class="row"
                class:selected={i === palette.selected}
                type="button"
                onclick={() => {
                  palette.selected = i;
                  void accept();
                }}
                onmousemove={() => (palette.selected = i)}
                title={item.kind === 'file' ? item.hit.path : undefined}
              >
                {#if item.kind === 'file'}
                  <span class="glyph" data-kind={kindOf(item.hit.name)}>
                    <Icon name={iconForFile(item.hit.name)} />
                  </span>
                  <span class="name">
                    {#each pieces(item.hit.name, item.hit.matched) as piece}
                      {#if piece.hit}<mark>{piece.text}</mark>{:else}{piece.text}{/if}
                    {/each}
                  </span>
                  <span class="aside">{place(item.hit.path, item.hit.rootId)}</span>
                {:else if item.kind === 'command'}
                  <!-- Значок команды тот же, что у неё в меню: строка палитры
                       и пункт меню — одно действие (Р-148). Запасной уголок
                       остаётся: команда без значка не должна ломать строку. -->
                  <span class="glyph">
                    <Icon name={iconForCommand(item.id) ?? 'palette.command'} />
                  </span>
                  <span class="name wide">
                    {#each split(item.title, term) as piece}
                      {#if piece.hit}<mark>{piece.text}</mark>{:else}{piece.text}{/if}
                    {/each}
                  </span>
                  {#if item.binding}
                    <kbd class="key">{labelOf(item.binding)}</kbd>
                  {/if}
                {:else}
                  <span class="glyph"><Icon name="palette.tag" /></span>
                  <span class="name wide">
                    {#each split(item.tag, term) as piece}
                      {#if piece.hit}<mark>{piece.text}</mark>{:else}{piece.text}{/if}
                    {/each}
                  </span>
                  <span class="aside count">
                    {item.count}
                  </span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: var(--zn-space-6);
    background-color: var(--zn-color-bg-overlay);
    z-index: var(--zn-z-dialog);
  }

  .palette {
    display: flex;
    flex-direction: column;
    width: var(--zn-control-dialog-max-width);
    max-width: 90%;
    max-height: 70%;
    overflow: hidden;
    background-color: var(--zn-color-bg-raised);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-window);
    box-shadow: var(--zn-shadow-dialog);
  }

  .head {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--zn-space-2);
    padding-inline: var(--zn-space-4);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .mode {
    flex: none;
    padding-inline: var(--zn-space-2);
    border-radius: var(--zn-radius-sm);
    background-color: var(--zn-color-bg-selected);
    color: var(--zn-color-accent);
    font-size: var(--zn-font-size-ui-small);
  }

  .field {
    flex: 1;
    min-width: 0;
    padding-block: var(--zn-space-3);
    border: none;
    background: transparent;
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
  }

  .field:focus {
    outline: none;
  }

  .hint,
  .key {
    flex: none;
    padding-inline: var(--zn-space-2);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-sm);
    color: var(--zn-color-fg-subtle);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
  }

  .list {
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
    width: 100%;
    height: var(--zn-control-row-height);
    padding-inline: var(--zn-space-4);
    border: none;
    background: transparent;
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    text-align: left;
    cursor: pointer;
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
    max-width: 50%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* У команды и тега нет пути справа, поэтому имени достаётся вся строка. */
  .name.wide {
    flex: 1;
    max-width: none;
  }

  mark {
    background: transparent;
    color: var(--zn-color-accent);
    font-weight: var(--zn-font-weight-strong);
  }

  .aside {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .count {
    flex: none;
    font-family: var(--zn-font-family-editor);
  }

  .empty {
    margin: 0;
    padding: var(--zn-space-4);
    color: var(--zn-color-fg-subtle);
  }
</style>
