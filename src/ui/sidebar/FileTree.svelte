<script lang="ts">
  import Icon from '../Icon.svelte';
  import { iconForFile, kindOf } from '../../icons/files';
  import { rows, toggle, tree, refreshDirs, type Row } from '../../state/tree.svelte';
  import { appearance } from '../../theme/store.svelte';
  import { openDropped, revealInExplorer } from '../../actions/files';
  import { removeRoot, createProject, importFromObsidian } from '../../actions/project';
  import { copyText } from '../../actions/clipboard';
  import { roots } from '../../state/roots.svelte';
  import { showMenu } from '../../state/menu.svelte';
  import { treeMenu, MENU } from '../menus';
  import { commandList } from '../../keymap/global.svelte';
  import { runCommand } from '../../keymap/registry';

  /**
   * Дерево файлов — виртуализованный список.
   *
   * На экране живут только видимые строки плюс небольшой запас сверху и снизу.
   * Без этого папка на десять тысяч файлов означала бы десять тысяч узлов DOM:
   * прокрутка перестала бы попадать в кадр, а раскрытие занимало бы секунды.
   *
   * Вложенность передаётся отступом, а не вложенными компонентами: у плоского
   * списка есть номер строки, а без него виртуализация невозможна.
   */

  const items = $derived.by(() => rows());

  let viewport: HTMLElement | undefined = $state();
  let scrollTop = $state(0);
  let viewportHeight = $state(0);

  /**
   * Высота строки берётся из токена, а не задаётся числом здесь: иначе
   * компактная плотность посчитала бы прокрутку по метрике обычной.
   * Ноль означает «ещё не измерено» — до первого измерения рисуем всё,
   * и это честнее, чем угадывать.
   */
  let rowHeight = $state(0);

  $effect(() => {
    // Зависимость от оформления: смена плотности меняет высоту строки.
    void appearance.current;
    const value = getComputedStyle(document.documentElement).getPropertyValue(
      '--zn-control-tree-row-height',
    );
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      rowHeight = parsed;
    }
  });

  $effect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver((entries) => {
      viewportHeight = entries[0]?.contentRect.height ?? 0;
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  });

  /** Запас строк за краями окна: прокрутка не должна обгонять отрисовку. */
  const OVERSCAN = 6;

  const first = $derived(
    rowHeight > 0 ? Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN) : 0,
  );
  const count = $derived(
    rowHeight > 0
      ? Math.ceil(viewportHeight / rowHeight) + OVERSCAN * 2
      : items.length,
  );
  const visible = $derived(items.slice(first, first + count));

  async function activate(row: Row): Promise<void> {
    if (row.isDir) {
      // В ссылку не заходим никогда: `ссылка → родительская папка` — петля
      // без дна (Р-054).
      if (row.isLink) return;
      await toggle(row.rootId, row.path);
      return;
    }
    await openDropped([row.path]);
  }

  function rootOf(row: Row) {
    return roots.items.find((r) => r.id === row.rootId);
  }

  /** Меню строки дерева: всё то же, что кнопками, плюс путь и проводник. */
  function onRowMenu(event: MouseEvent, row: Row): void {
    const root = row.isRoot ? rootOf(row) : undefined;

    showMenu(
      event,
      treeMenu(
        {
          row: {
            isDir: row.isDir,
            isRoot: row.isRoot,
            isLink: row.isLink,
            expanded: row.expanded,
          },
          root: root
            ? {
                hasProjectFile: root.hasProjectFile,
                hasObsidianConfig: root.hasObsidianConfig,
              }
            : null,
        },
        commandList(),
      ),
      (choice) => {
        switch (choice) {
          case MENU.open:
          case MENU.toggle:
            void activate(row);
            return;
          case MENU.refresh:
            void refreshDirs([row.path]);
            return;
          case MENU.copyPath:
            void copyText(row.path);
            return;
          case MENU.copyName:
            void copyText(row.name);
            return;
          case MENU.reveal:
            void revealInExplorer(row.path);
            return;
          case MENU.projectFile:
            void createProject(row.rootId);
            return;
          case MENU.obsidian:
            void importFromObsidian(row.rootId);
            return;
          case MENU.removeRoot:
            void removeRoot(row.rootId);
            return;
          default:
            runCommand(choice);
        }
      },
    );
  }

  /**
   * Меню пустого места панели.
   *
   * Сюда событие доходит только если по строке не попали: обработчик строки
   * останавливает распространение.
   */
  function onEmptyMenu(event: MouseEvent): void {
    showMenu(event, treeMenu({ row: null }, commandList()), runCommand);
  }
</script>

<!-- Предупреждения сняты сознательно, и оба раза по одной причине: правый
     щелчок не делает элемент интерактивным. Нажимается в дереве кнопка внутри
     строки — она и получает фокус, и принимает клавиши. Меню же повторяет
     то, что уже есть кнопками строки, и роль на обёртке была бы неправдой. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="viewport"
  bind:this={viewport}
  onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
  oncontextmenu={onEmptyMenu}
>
  <div class="total" style:height={rowHeight > 0 ? `${items.length * rowHeight}px` : 'auto'}>
    <div class="window" style:transform={`translateY(${first * rowHeight}px)`}>
      {#each visible as row (row.path)}
        {@const root = row.isRoot ? rootOf(row) : undefined}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="line"
          class:root={row.isRoot}
          class:missing={root && !root.available}
          oncontextmenu={(e) => onRowMenu(e, row)}
        >
          <button
            class="row"
            type="button"
            style:padding-left={`calc(var(--zn-space-2) + ${row.depth} * var(--zn-control-tree-indent))`}
            onclick={() => activate(row)}
            title={row.isLink ? `${row.path} — ссылка, внутрь не заходим` : row.path}
          >
            <span class="twist" class:open={row.expanded} class:hidden={!row.isDir || row.isLink}>
              <Icon name="tree.chevron" />
            </span>

            <span class="glyph" data-kind={row.isDir ? 'folder' : kindOf(row.name)}>
              {#if row.isDir}
                <Icon name={row.expanded ? 'tree.folder-open' : 'status.folder'} />
              {:else}
                <Icon name={iconForFile(row.name)} />
              {/if}
            </span>

            <span class="name">{row.name}</span>

            {#if tree.loading.includes(row.path)}
              <span class="note">…</span>
            {:else if tree.failed[row.path]}
              <span class="note failed" title={tree.failed[row.path]}>
                <Icon name="status.warning" />
              </span>
            {/if}
          </button>

          {#if root}
            {#if root.hasObsidianConfig}
              <button
                class="action"
                type="button"
                onclick={() => importFromObsidian(root.id)}
                title="Хранилище Obsidian: перенести настройки в zeronote.toml"
                aria-label="Перенести настройки Obsidian"
              >
                <Icon name="action.obsidian" />
              </button>
            {/if}
            {#if !root.hasProjectFile}
              <button
                class="action"
                type="button"
                onclick={() => createProject(root.id)}
                title="Создать zeronote.toml"
                aria-label="Создать файл проекта"
              >
                <Icon name="action.project-file" />
              </button>
            {/if}
            <button
              class="action"
              type="button"
              onclick={() => removeRoot(root.id)}
              title="Убрать папку из рабочего пространства"
              aria-label="Убрать папку"
            >
              <Icon name="action.remove" />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .viewport {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  /* Распорка на всю высоту списка: полоса прокрутки должна показывать
     настоящий размер дерева, а не размер нарисованного куска. */
  .total {
    position: relative;
  }

  .window {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
  }

  .line {
    display: flex;
    align-items: center;
    height: var(--zn-control-tree-row-height);
  }

  .line:hover {
    background-color: var(--zn-color-bg-hover);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    flex: 1;
    min-width: 0;
    height: 100%;
    padding-right: var(--zn-space-2);
    border: none;
    background: transparent;
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    text-align: left;
    cursor: pointer;
  }

  .row:focus-visible {
    outline: var(--zn-border-width-thick) solid var(--zn-color-border-focus);
    outline-offset: calc(-1 * var(--zn-border-width-thick));
  }

  .root .row {
    font-weight: var(--zn-font-weight-medium);
  }

  .missing .row {
    color: var(--zn-color-fg-subtle);
  }

  .twist {
    display: inline-flex;
    flex: none;
    color: var(--zn-color-fg-subtle);
    transition: transform var(--zn-motion-duration-fast) var(--zn-motion-easing);
  }

  .twist.open {
    transform: rotate(90deg);
  }

  /* Место под уголок остаётся занятым и у файлов: иначе имена в одной папке
     не выстраиваются в столбец. */
  .twist.hidden {
    visibility: hidden;
  }

  /* Цвет значка по виду файла — те же роли, что у вкладок. Папка своего
     цвета не получает: её и так видно по форме и по уголку раскрытия,
     а раскрашенная папка спорила бы с файлами внутри неё. */
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
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .note {
    display: inline-flex;
    flex: none;
    margin-left: auto;
    color: var(--zn-color-fg-subtle);
  }

  .note.failed {
    color: var(--zn-color-warning);
  }

  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--zn-control-tree-row-height);
    height: var(--zn-control-tree-row-height);
    padding: 0;
    border: none;
    border-radius: var(--zn-radius-sm);
    background: transparent;
    color: var(--zn-color-fg-muted);
    cursor: pointer;
    visibility: hidden;
  }

  .line:hover .action,
  .line:focus-within .action {
    visibility: visible;
  }

  .action:hover {
    background-color: var(--zn-color-bg-active);
    color: var(--zn-color-fg-default);
  }

  .action:focus-visible {
    outline: var(--zn-border-width-thick) solid var(--zn-color-border-focus);
    outline-offset: calc(-1 * var(--zn-border-width-thick));
  }
</style>
