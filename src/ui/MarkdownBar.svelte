<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from '../icons/registry';
  import { commandList } from '../keymap/global.svelte';
  import { labelOf } from '../keymap/binding';
  import { runCommand } from '../keymap/registry';
  import { showMenu } from '../state/menu.svelte';
  import { snippetMenu } from './menus';

  /**
   * Панель разметки markdown.
   *
   * Ни одна кнопка не заводит своего действия: все ссылаются на команды
   * реестра, оттуда же берут подпись сочетания, если оно назначено (Р-107).
   * Иначе панель и палитра разъехались бы, а заметить это можно было бы
   * только глазами.
   *
   * Сочетаний у этих команд по умолчанию нет (Р-127) — панель и есть их
   * основной способ вызова, а кому нужны клавиши, назначит их во вкладке
   * «Клавиши».
   */

  interface Button {
    command: string;
    icon?: IconName;
    /** Подпись вместо значка: у заголовков она короче и понятнее рисунка. */
    text?: string;
    /** Отделить группу чертой слева. */
    group?: boolean;
  }

  const BUTTONS: Button[] = [
    { command: 'md.bold', icon: 'md.bold' },
    { command: 'md.italic', icon: 'md.italic' },
    { command: 'md.strikethrough', icon: 'md.strikethrough' },
    { command: 'md.highlight', icon: 'md.highlight' },
    { command: 'md.code', icon: 'md.code' },

    { command: 'md.heading-1', text: 'H1', group: true },
    { command: 'md.heading-2', text: 'H2' },
    { command: 'md.heading-3', text: 'H3' },

    { command: 'md.bullet-list', icon: 'md.bullet-list', group: true },
    { command: 'md.ordered-list', icon: 'md.ordered-list' },
    { command: 'md.task-list', icon: 'md.task-list' },
    { command: 'md.quote', icon: 'md.quote' },

    { command: 'md.link', icon: 'md.link', group: true },
  ];

  /** Названия и сочетания команд — из раскладки, а не из разметки. */
  const commands = $derived(commandList());

  function hint(id: string): string {
    const found = commands.find((command) => command.id === id);
    if (!found) return id;
    return found.binding ? `${found.title} · ${labelOf(found.binding)}` : found.title;
  }

  /**
   * Заготовки — меню, а не три кнопки в ряду: их будет больше, а место
   * в строке кончится раньше.
   */
  function snippets(event: MouseEvent): void {
    showMenu(event, snippetMenu(commands), (id) => runCommand(id));
  }

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

<div class="bar panel" role="toolbar" aria-label="Разметка markdown">
  {#each BUTTONS as button (button.command)}
    <button
      class="key"
      class:group={button.group}
      class:text={button.text !== undefined}
      type="button"
      title={hint(button.command)}
      aria-label={hint(button.command)}
      onmousedown={keepFocus}
      onclick={() => runCommand(button.command)}
    >
      {#if button.icon}
        <Icon name={button.icon} />
      {:else}
        {button.text}
      {/if}
    </button>
  {/each}

  <button
    class="key group"
    type="button"
    title="Заготовки: таблица, блок кода, разделитель"
    aria-label="Заготовки"
    onmousedown={keepFocus}
    onclick={snippets}
  >
    <Icon name="md.snippets" />
  </button>
</div>

<style>
  /* Панель отделена от текста чертой, а не отступом. Отступ говорит «здесь
     пусто», черта — «здесь кончаются кнопки и начинается ваш файл»; второе
     и есть правда. */
  .bar {
    display: flex;
    align-items: center;
    gap: var(--zn-space-1);
    flex: none;
    /* Высота в один ряд — общая для всех полос инструментов в окне: столько же
       у заголовка боковой панели и у поля поиска в ней.

       Полоса растёт вниз, а не обрезается: шестнадцать кнопок
       с разделителями — около 430 px, и в узком окне последние молча уезжали
       за правый край. Нашёл владелец, работая в программе каждый день.

       Перенос, а не прокрутка, хотя у полосы вкладок рядом сделана
       прокрутка. Разница в том, что вкладок сколько угодно, а кнопок
       ровно шестнадцать: перенос кончается на второй строке, и всё видно
       сразу. Прокрутка же оставляет кнопку за краем — а обычное колесо
       горизонтальную полосу не двигает, проверено на живом окне: нужен
       либо горизонтальный ролик, либо свой обработчик. Панель для того
       и панель, чтобы кнопки было видно. */
    min-height: var(--zn-control-toolbar-height);
    flex-wrap: wrap;
    row-gap: var(--zn-space-1);
    padding-block: var(--zn-space-1);
    padding-inline: var(--zn-space-3);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* Кнопки не ужимаются: сжатие превратило бы их в нечитаемые полоски
       вместо честного переноса на вторую строку. */
    flex: none;
    width: var(--zn-control-toolbar-button-size);
    height: var(--zn-control-toolbar-button-size);
    border: none;
    border-radius: var(--zn-radius-md);
    background: none;
    color: var(--zn-color-fg-muted);
    font-family: inherit;
    font-size: var(--zn-font-size-ui-small);
    cursor: default;
  }

  .key:hover {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  /* Черта слева отделяет группы: начертания, заголовки, списки, ссылка. */
  .group {
    margin-left: var(--zn-space-2);
    border-left: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    padding-left: var(--zn-space-2);
    width: auto;
    min-width: var(--zn-control-toolbar-button-size);
  }

  .text {
    font-family: var(--zn-font-family-editor);
  }
</style>
