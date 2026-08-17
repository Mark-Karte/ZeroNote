<script lang="ts">
  import Icon from '../Icon.svelte';
  import { iconForFile } from '../../icons/files';
  import { palette, refresh, close, move, accept } from '../../state/palette.svelte';
  import { roots } from '../../state/roots.svelte';

  /**
   * Быстрое открытие по имени (Р-045).
   *
   * Список не виртуализуется намеренно: показывается полсотни строк, и
   * распорка с окном тут стоила бы больше, чем экономила.
   */

  let field: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (palette.open) field?.focus();
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
      <input
        class="field"
        type="text"
        bind:this={field}
        bind:value={palette.query}
        oninput={() => void refresh()}
        onkeydown={onKeyDown}
        placeholder="Имя файла"
        aria-label="Быстрое открытие по имени"
        spellcheck="false"
      />

      {#if palette.items.length === 0}
        <p class="empty">
          {palette.query === '' ? 'В индексе пока нет файлов' : 'Ничего не найдено'}
        </p>
      {:else}
        <ul class="list">
          {#each palette.items as item, i (item.path)}
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
                title={item.path}
              >
                <Icon name={iconForFile(item.name)} />
                <span class="name">
                  {#each pieces(item.name, item.matched) as piece}
                    {#if piece.hit}<mark>{piece.text}</mark>{:else}{piece.text}{/if}
                  {/each}
                </span>
                <span class="place">{place(item.path, item.rootId)}</span>
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
    border-radius: var(--zn-radius-lg);
    box-shadow: var(--zn-shadow-overlay);
  }

  .field {
    flex: none;
    padding: var(--zn-space-3) var(--zn-space-4);
    border: none;
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
    background: transparent;
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
  }

  .field:focus {
    outline: none;
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

  .name {
    flex: none;
    max-width: 50%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  mark {
    background: transparent;
    color: var(--zn-color-accent);
    font-weight: var(--zn-font-weight-medium);
  }

  .place {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .empty {
    margin: 0;
    padding: var(--zn-space-4);
    color: var(--zn-color-fg-subtle);
  }
</style>
