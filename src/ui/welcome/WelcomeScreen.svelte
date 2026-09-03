<script lang="ts">
  import Icon from '../Icon.svelte';
  import { iconForFile, kindOf } from '../../icons/files';
  import { ago } from './ago';
  import { recentFiles, type RecentEntry } from '../../ipc/recent';
  import { openPath } from '../../state/tabs.svelte';
  import { commandList } from '../../keymap/global.svelte';
  import { labelOf } from '../../keymap/binding';
  import { version } from '../../version';

  /**
   * Стартовый экран: что делать, когда ничего не открыто.
   *
   * Сочетания не зашиты, а берутся из действующей раскладки: переназначив
   * Ctrl+O в `keymap.toml`, пользователь увидит здесь своё сочетание. Экран,
   * который врёт про горячие клавиши, хуже, чем экран без них.
   */

  const START: { id: string; fallback: string }[] = [
    { id: 'file.new', fallback: 'Создать файл' },
    { id: 'file.open', fallback: 'Открыть файл' },
    { id: 'project.add-root', fallback: 'Открыть папку' },
    { id: 'project.quick-open', fallback: 'Быстрое открытие' },
  ];

  const commands = $derived.by(() => {
    const all = commandList();
    return START.map(({ id, fallback }) => {
      const found = all.find((command) => command.id === id);
      return {
        id,
        title: found?.title ?? fallback,
        binding: found?.binding ?? null,
      };
    });
  });

  let recent = $state<RecentEntry[]>([]);

  // Время берётся один раз на отрисовку списка: иначе две строки, посчитанные
  // в разные миллисекунды, могли бы разойтись на границе минуты.
  let now = $state(Date.now());

  $effect(() => {
    void (async () => {
      recent = await recentFiles();
      now = Date.now();
    })();
  });

  /** Имя файла и папка, в которой он лежит. */
  function parts(path: string): { name: string; place: string } {
    const pieces = path.split(/[\\/]/).filter((piece) => piece !== '');
    const name = pieces.pop() ?? path;
    return { name, place: pieces.slice(-2).join(' / ') };
  }
</script>

<div class="screen">
  <div class="page">
    <section class="about">
      <span class="mark"><Icon name="app.mark" /></span>
      <h1 class="name">ZeroNote</h1>
      <p class="tagline">
        Быстрый редактор файлов и связанных заметок в одном окне.
      </p>

      <ul class="keys">
        {#each commands as command (command.id)}
          <li class="key-row">
            {#if command.binding}
              <kbd class="key">{labelOf(command.binding)}</kbd>
            {:else}
              <span class="key empty">—</span>
            {/if}
            <span class="key-title">{command.title}</span>
          </li>
        {/each}
      </ul>

      <p class="drop">Либо перетащите файл или папку в окно.</p>
    </section>

    <section class="recent">
      <h2 class="caption">Недавнее</h2>

      {#if recent.length === 0}
        <p class="nothing">Здесь появятся файлы, которые вы открывали.</p>
      {:else}
        <ul class="list">
          {#each recent.slice(0, 6) as entry (entry.path)}
            {@const place = parts(entry.path)}
            <li>
              <button
                class="row"
                type="button"
                onclick={() => openPath(entry.path)}
                title={entry.path}
              >
                <span class="glyph" data-kind={kindOf(place.name)}>
                  <Icon name={iconForFile(place.name)} />
                </span>
                <span class="file">
                  <span class="file-name">{place.name}</span>
                  <span class="file-place">{place.place}</span>
                </span>
                <span class="when">{ago(entry.openedAt, now)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <p class="version">Версия {version}</p>
  </div>
</div>

<style>
  .screen {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
  }

  .page {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--zn-space-6);
    width: 100%;
    max-width: var(--zn-control-page-width);
    padding: var(--zn-space-6);
  }

  /* Узкое окно: колонки в столбик, иначе обе становятся нечитаемо тесными. */
  @media (width < 48rem) {
    .page {
      grid-template-columns: 1fr;
    }
  }

  /* На стартовом экране знак — главный элемент, а не подпись к строке,
     поэтому вдвое крупнее обычного значка. Размер задан здесь, потому что
     он у значка пока один на всё приложение; ролью он станет в задаче 26. */
  .mark {
    display: inline-flex;
    color: var(--zn-color-fg-default);
  }

  .mark :global(.icon) {
    width: calc(var(--zn-control-icon-size) * 2);
    height: calc(var(--zn-control-icon-size) * 2);
  }

  .name {
    margin: var(--zn-space-4) 0 0 0;
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-title);
    font-weight: var(--zn-font-weight-strong);
    letter-spacing: var(--zn-font-letter-spacing-tight);
  }

  .tagline {
    margin: var(--zn-space-2) 0 var(--zn-space-6) 0;
    color: var(--zn-color-fg-muted);
  }

  .keys {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .key-row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
  }

  .key {
    flex: none;
    min-width: var(--zn-control-window-button-width);
    padding-inline: var(--zn-space-2);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-sm);
    background-color: var(--zn-color-bg-surface);
    color: var(--zn-color-fg-muted);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
    text-align: center;
  }

  /* Команда без сочетания — это переназначенная раскладка, а не ошибка. */
  .key.empty {
    color: var(--zn-color-fg-subtle);
  }

  .key-title {
    color: var(--zn-color-fg-muted);
  }

  .drop {
    margin: var(--zn-space-5) 0 0 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .caption {
    margin: 0 0 var(--zn-space-3) 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
    font-weight: var(--zn-font-weight-strong);
    text-transform: uppercase;
    letter-spacing: var(--zn-font-letter-spacing-caps);
  }

  .nothing {
    margin: 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
    width: 100%;
    padding: var(--zn-space-2) var(--zn-space-3);
    border: none;
    border-radius: var(--zn-radius-md);
    background: transparent;
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background-color: var(--zn-color-bg-hover);
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

  .file {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
  }

  .file-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .file-place {
    color: var(--zn-color-fg-subtle);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .when {
    flex: none;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .version {
    grid-column: 1 / -1;
    margin: var(--zn-space-5) 0 0 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }
</style>
