<script lang="ts">
  import { redoDepth, undoDepth } from '@codemirror/commands';
  import Icon from './Icon.svelte';
  import { iconForCommand } from '../icons/commands';
  import { commandList } from '../keymap/global.svelte';
  import { labelOf } from '../keymap/binding';
  import { runCommand } from '../keymap/registry';
  import { canGoBack, canGoForward } from '../state/history.svelte';
  import { roots } from '../state/roots.svelte';
  import type { Tab } from '../state/tabs.svelte';
  import { crumbsFor } from './crumbs';
  import { dimmed, textLabelOf, type ToolbarEntry, type ToolbarSize } from './toolbar';

  /**
   * Панель инструментов (задача 102).
   *
   * Что на ней стоит и над какой вкладкой, решает не она: состав приходит
   * из настроек, отбор под вид вкладки — из `ui/toolbar.ts`, а место —
   * от области (`PaneView`). Панель рисует и знает ровно одно: что из
   * нарисованного сейчас нельзя нажать.
   *
   * Ни одна кнопка не заводит своего действия (Р-107): все ссылаются
   * на команды реестра и оттуда же берут подпись с сочетанием. Иначе
   * панель и палитра разъехались бы, и заметить это можно было бы только
   * глазами.
   */
  let {
    entries,
    column = false,
    size = 'normal',
    tab = null,
  }: {
    entries: ToolbarEntry[];
    /** Стоять ли над колонкой читаемой ширины (задача 81). */
    column?: boolean;
    size?: ToolbarSize;
    /** Вкладка, над которой стоит панель: у неё спрашивают про отмену и путь. */
    tab?: Tab | null;
  } = $props();

  /** Названия и сочетания команд — из раскладки, а не из разметки. */
  const commands = $derived(commandList());

  function hint(id: string): string {
    const found = commands.find((command) => command.id === id);
    if (!found) return id;
    return found.binding ? `${found.title} · ${labelOf(found.binding)}` : found.title;
  }

  /**
   * Что сейчас можно сделать. История отмены — у главного состояния буфера
   * (Р-209): отмена в области с зеркалом считается там же, где её выполнит
   * команда, иначе кнопка гасла бы в зеркале при живой истории.
   */
  const ability = $derived({
    undo: tab?.editor ? undoDepth(tab.editor.state) > 0 : false,
    redo: tab?.editor ? redoDepth(tab.editor.state) > 0 : false,
    back: canGoBack(),
    forward: canGoForward(),
  });

  /** Путь к файлу крошками — тот же, что в шапке, и тем же правилом. */
  const crumbs = $derived(crumbsFor(tab?.meta.path ?? null, roots.items));

  /**
   * Нажатие мыши не должно уводить фокус из текста.
   *
   * Кнопка забирает его по умолчанию, и тогда команда выполняется над
   * редактором, который только что потерял курсор: выделение сбрасывается,
   * а разметка встаёт не туда. Гасим `mousedown` — щелчок при этом
   * срабатывает как обычно.
   */
  function keepFocus(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

<div class="bar panel">
  <div class="keys {size}" class:column role="toolbar" aria-label="Панель инструментов">
    {#each entries as entry, index (index)}
      {#if entry.kind === 'command'}
        {@const label = textLabelOf(entry.id)}
        {@const icon = iconForCommand(entry.id)}
        <button
          class="key"
          class:text={label !== null}
          type="button"
          disabled={dimmed(entry.id, ability)}
          title={hint(entry.id)}
          aria-label={hint(entry.id)}
          onmousedown={keepFocus}
          onclick={() => runCommand(entry.id)}
        >
          {#if label !== null}
            {label}
          {:else if icon}
            <Icon name={icon} />
          {/if}
        </button>
      {:else if entry.kind === 'separator'}
        <span class="separator" aria-hidden="true"></span>
      {:else if entry.kind === 'spacer'}
        <span class="spacer" aria-hidden="true"></span>
      {:else if crumbs.length > 0}
        <!-- Путь обрезается слева: конец пути — имя файла и папка над ним —
             важнее начала, которое у всех файлов проекта одно и то же. -->
        <span class="path" title={tab?.meta.path ?? ''}>
          <bdi dir="ltr">
            {#each crumbs as crumb, place (place)}
              {#if place > 0}<span class="sep">/</span>{/if}<span
                class="crumb"
                class:leaf={crumb.leaf}>{crumb.text}</span
              >
            {/each}
          </bdi>
        </span>
      {/if}
    {/each}
  </div>
</div>

<style>
  /* Панель отделена от текста чертой, а не отступом. Отступ говорит «здесь
     пусто», черта — «здесь кончаются кнопки и начинается ваш файл»; второе
     и есть правда. */
  .bar {
    display: flex;
    flex: none;
    /* Высота в один ряд — общая для всех полос инструментов в окне: столько же
       у заголовка боковой панели и у поля поиска в ней. */
    min-height: var(--zn-control-toolbar-height);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  /* Кнопки лежат отдельным слоем внутри полосы: над колонкой едут они,
     а полоса с чертой остаётся во всю ширину области (задача 81). */
  .keys {
    display: flex;
    align-items: center;
    gap: var(--zn-space-1);
    width: 100%;
    /* Полоса растёт вниз, а не обрезается и не прокручивается (Р-172):
       кнопок конечное число, перенос кончается на втором-третьем ряду,
       и всё видно сразу. Несколько рядов — решение владельца. */
    flex-wrap: wrap;
    row-gap: var(--zn-space-1);
    padding-block: var(--zn-space-1);
    padding-inline: var(--zn-space-3);
  }

  /* Размер кнопок — ступенью, а не числом (задача 102): значки нарисованы
     под сетку, и кнопка произвольного размера размыла бы их. У крупной
     ступени и значок крупнее — роль плитки, двадцать точек. */
  .keys.small {
    --zn-control-toolbar-button-size: var(--zn-control-toolbar-button-size-small);
  }

  .keys.large {
    --zn-control-toolbar-button-size: var(--zn-control-toolbar-button-size-large);
    --zn-control-icon-size: var(--zn-control-icon-size-tile);
  }

  /* Над колонкой читаемой ширины (Р-215). Шрифт редактора здесь ради
     единицы `ch`: колонка задана в знаках, и знак интерфейсного шрифта
     дал бы другую ширину. Кнопкам шрифт не достаётся — ниже он задан
     токеном, а не `inherit`. */
  .keys.column {
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-editor);
    max-width: var(--zn-control-editor-width);
    margin-inline: auto;
  }

  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* Кнопки не ужимаются: сжатие превратило бы их в нечитаемые полоски
       вместо честного переноса на следующий ряд. */
    flex: none;
    width: var(--zn-control-toolbar-button-size);
    height: var(--zn-control-toolbar-button-size);
    border: none;
    border-radius: var(--zn-radius-md);
    background: none;
    color: var(--zn-color-fg-muted);
    font-family: var(--zn-font-family-ui);
    font-size: var(--zn-font-size-ui-small);
    cursor: default;
  }

  .key:hover:not(:disabled) {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  /* Нельзя нажать — гаснет цветом, а не прозрачностью (Р-189): прозрачность
     смешала бы кнопку с подложкой, а у нас три разных фона (Р-083). */
  .key:disabled {
    color: var(--zn-color-fg-subtle);
  }

  .text {
    font-family: var(--zn-font-family-editor);
  }

  .separator {
    flex: none;
    align-self: stretch;
    width: var(--zn-border-width);
    margin: var(--zn-space-1) var(--zn-space-2);
    background-color: var(--zn-color-border-subtle);
  }

  /* Распорка: всё после неё уезжает к правому краю ряда. */
  .spacer {
    flex: 1;
  }

  /* Путь обрезается слева. Приём известный: блок пишется справа налево,
     поэтому лишнее уходит за левый край и заменяется многоточием, а сам
     путь внутри `<bdi dir="ltr">` читается как обычно. */
  .path {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
    padding-inline: var(--zn-space-2);
    color: var(--zn-color-fg-subtle);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
  }

  .crumb.leaf {
    color: var(--zn-color-fg-muted);
  }

  .sep {
    margin-inline: var(--zn-space-2);
    opacity: 0.6;
  }
</style>
