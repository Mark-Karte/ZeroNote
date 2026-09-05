<script lang="ts">
  import Icon from '../Icon.svelte';
  import { tabs, setActive } from '../../state/tabs.svelte';
  import { editorView } from '../../editor/current';
  import { goToLine } from '../../editor/commands';
  import { bookmarkLines } from '../../editor/bookmarks';
  import { bookmarkGroups, bookmarkCount } from '../../editor/bookmark-list';
  import { labelOf } from '../../keymap/binding';
  import { commandList } from '../../keymap/global.svelte';

  /**
   * Панель закладок: строки, помеченные `Ctrl+F2`, списком.
   *
   * Метки у номеров строк есть с задачи 37 — панель показывает то, чего
   * в поле номеров нет: **текст** помеченной строки и закладки соседних
   * вкладок (Р-157).
   *
   * Своего модуля состояния у панели нет, в отличие от оглавления: там
   * список — проход по всему документу, и он идёт с задержкой. Здесь проход
   * по набору из нескольких закладок, и считать его на месте дешевле, чем
   * заводить ради этого хранилище с таймером.
   */

  const groups = $derived(
    bookmarkGroups(
      tabs.items.map((tab) => ({
        id: tab.meta.id,
        title: tab.meta.title,
        lines: bookmarkLines(tab.editor),
        lineCount: tab.editor.doc.lines,
        lineText: (line: number) => tab.editor.doc.line(line).text,
      })),
    ),
  );

  const total = $derived(bookmarkCount(groups));

  /** Сочетание берётся из раскладки: в файле его могли переназначить. */
  const toggleKey = $derived(
    commandList().find((command) => command.id === 'view.bookmark')?.binding ?? null,
  );

  function go(tabId: number, line: number): void {
    if (tabs.activeId !== tabId) setActive(tabId);

    // Переход после подстановки состояния в представление: до неё в окне
    // лежит ещё прошлая вкладка, и прокрутка ушла бы не в тот документ.
    // Тот же приём, что у перехода по ссылке в другой файл.
    queueMicrotask(() => {
      const view = editorView();
      if (view) goToLine(view, line);
    });
  }
</script>

<div class="panel">
  <header class="head">
    <span class="title">Закладки</span>
    {#if total > 0}
      <span class="count">{total}</span>
    {/if}
  </header>

  {#if total === 0}
    <p class="note">
      Закладок нет. {labelOf(toggleKey ?? 'ctrl+f2')} — поставить или снять на строке курсора.
    </p>
  {:else}
    <div class="list">
      {#each groups as group (group.tabId)}
        <!-- Заголовок группы стоит всегда, даже когда открытый файл один:
             иначе список молча менял бы вид от того, сколько вкладок открыто,
             и строка «42» без имени файла означала бы разное в разное время. -->
        <div class="file" title={group.title}>
          <Icon name="cmd.bookmark" />
          <span class="name">{group.title}</span>
        </div>

        {#each group.rows as row (row.line)}
          <button
            class="row"
            class:current={tabs.activeId === row.tabId}
            type="button"
            onclick={() => go(row.tabId, row.line)}
            title={`${group.title}, строка ${row.line}`}
          >
            <span class="line">{row.line}</span>
            <span class="text" class:empty={row.text === ''}>
              {row.text === '' ? 'пустая строка' : row.text}
            </span>
          </button>
        {/each}
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    height: var(--zn-control-toolbar-height);
    flex: none;
    padding-inline: var(--zn-space-4);
  }

  .title {
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
    font-weight: var(--zn-font-weight-strong);
    text-transform: uppercase;
    letter-spacing: var(--zn-font-letter-spacing-caps);
  }

  .count {
    color: var(--zn-color-fg-subtle);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
  }

  .note {
    margin: 0;
    padding: 0 var(--zn-space-4) var(--zn-space-2);
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .list {
    overflow: auto;
  }

  /* Имя файла — заголовок группы, а не строка списка: по нему не щёлкают.
     Тот же вид, что у заголовка панели, но тише: это подпись внутри списка,
     а не название панели. */
  .file {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    height: var(--zn-control-row-height);
    padding-inline: var(--zn-space-4);
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
  }

  /* Между группами — воздух, но только между: у первой группы отступ сверху
     оторвал бы её от заголовка панели. */
  .file:not(:first-child) {
    margin-top: var(--zn-space-3);
  }

  .file .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
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

  .row:hover {
    background-color: var(--zn-color-bg-hover);
  }

  /* Закладки открытой вкладки — обычным текстом, чужие тише: список
     показывает и те и другие, и разница между «здесь» и «там» должна
     читаться без чтения имён файлов. */
  .row:not(.current) .text {
    color: var(--zn-color-fg-muted);
  }

  /* Номер строки — моноширинным и тише текста: это адрес, а не содержание.
     Тем же шрифтом, что номера в поле редактора. */
  .line {
    flex: none;
    min-width: var(--zn-space-6);
    color: var(--zn-color-fg-subtle);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
    text-align: right;
  }

  .text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* Помеченная пустая строка — не ошибка: так помечают место, куда вернутся
     писать. Но показать нечего, и подпись об этом говорит прямо. */
  .text.empty {
    color: var(--zn-color-fg-subtle);
    font-style: italic;
  }
</style>
