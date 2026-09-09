<script lang="ts">
  import Icon from '../Icon.svelte';
  import FileTree from './FileTree.svelte';
  import { vaultRoot } from '../../state/roots.svelte';
  import { expand, isExpanded } from '../../state/tree.svelte';
  import { openDaily } from '../../actions/daily';
  import { insertOne, newOne } from '../../actions/templates';
  import { listTemplates, type Template } from '../../ipc/notes';
  import { createEntry } from '../../actions/entries';
  import { showSettings } from '../../actions/project';
  import { labelOf } from '../../keymap/binding';
  import { commandList } from '../../keymap/global.svelte';

  /**
   * Панель «Заметки» — дом для записей (задача 94).
   *
   * Показывает дерево папки заметок, и показывает его всегда: закрыв все
   * проекты, до заметок по-прежнему можно добраться. Ядру эта папка —
   * обычный корень, поэтому здесь тот же `FileTree`, что и в «Папках»:
   * раскрытие, слежение, создание, переименование и удаление в корзину
   * достались готовыми (задача 38).
   *
   * Шаблоны будут разделом этой же панели, а не восьмым значком в полосе:
   * их открывают раз в месяц, а заметки каждый день.
   */

  const vault = $derived(vaultRoot());

  /**
   * Заготовки читаются при показе панели, а не по таймеру.
   *
   * Панель размонтируется при переключении на соседнюю, поэтому возврат
   * к ней — и есть перечитывание. Шаблоны добавляют раз в месяц; следить
   * за папкой ради этого значило бы держать наблюдатель ради списка
   * из пяти строк.
   */
  let templates: Template[] = $state([]);

  $effect(() => {
    void listTemplates()
      .then((items) => {
        templates = items;
      })
      .catch(() => {
        templates = [];
      });
  });

  /**
   * Корень раскрывается сам, когда панель открыли.
   *
   * У «Папок» раскрытие — выбор человека: папок там несколько и открывал
   * он их сам. Здесь папка одна и она и есть содержимое панели; свёрнутая
   * строка с её именем не сообщала бы ничего.
   */
  $effect(() => {
    if (vault?.available && !isExpanded(vault.path)) {
      void expand(vault.id, vault.path);
    }
  });

  /** Сочетание берётся из раскладки: команде его могли назначить (Р-127). */
  const dailyKey = $derived(
    commandList().find((command) => command.id === 'project.daily-note')?.binding ?? null,
  );
</script>

<div class="panel">
  <header class="head">
    <span class="title">Заметки</span>
    <button
      class="action"
      type="button"
      onclick={() => void openDaily()}
      title={dailyKey ? `Заметка на сегодня (${labelOf(dailyKey)})` : 'Заметка на сегодня'}
      aria-label="Заметка на сегодня"
    >
      <Icon name="cmd.daily-note" />
    </button>
    <button
      class="action"
      type="button"
      disabled={!vault?.available}
      onclick={() => vault && void createEntry(vault.path, false)}
      title="Новая заметка в папке заметок"
      aria-label="Новая заметка"
    >
      <Icon name="cmd.file-new" />
    </button>
  </header>

  {#if !vault}
    <p class="empty">Папка заметок не готова</p>
    <p class="hint">Проверьте [notes] vault в настройках</p>
  {:else if !vault.available}
    <p class="empty">Папка недоступна</p>
    <p class="hint">{vault.path}</p>
    <p class="hint">
      <button class="link" type="button" onclick={() => void showSettings()}>
        Открыть параметры
      </button>
    </p>
  {:else}
    <FileTree scope="notes" />
  {/if}

  <!-- Шаблоны — раздел этой панели, а не восьмой значок в полосе: их
       открывают раз в месяц, а заметки каждый день, и равные по весу
       кнопки сказали бы неправду о том, чем пользуются. -->
  <section class="templates">
    <header class="head">
      <span class="title">Шаблоны</span>
    </header>

    {#if templates.length === 0}
      <p class="hint">
        Папка шаблонов не задана —
        <button class="link" type="button" onclick={() => void showSettings()}>
          в параметрах
        </button>
      </p>
    {:else}
      <ul class="list">
        {#each templates as template (template.path)}
          <li class="row">
            <!-- Щелчок вставляет: это то, ради чего заготовку открывают
                 чаще всего. Новая заметка — соседней кнопкой, чтобы одно
                 нажатие не означало двух разных дел. -->
            <button
              class="name"
              type="button"
              title="Вставить «{template.name}» в открытую заметку"
              onclick={() => void insertOne(template)}
            >
              <Icon name="cmd.template-insert" />
              <span class="label">{template.name}</span>
            </button>
            <button
              class="action"
              type="button"
              title="Новая заметка из «{template.name}»"
              aria-label="Новая заметка из «{template.name}»"
              onclick={() => void newOne(template)}
            >
              <Icon name="cmd.template-new" />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
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

  /* Кнопки уезжают вправо: первая из них получает отступ слева, остальные
     стоят рядом. Так же устроена шапка панели «Папки». */
  .action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--zn-control-row-height);
    height: var(--zn-control-row-height);
    padding: 0;
    border: none;
    border-radius: var(--zn-radius-sm);
    background: transparent;
    color: var(--zn-color-fg-muted);
    cursor: pointer;
  }

  .action:first-of-type {
    margin-left: auto;
  }

  .action:hover:not(:disabled) {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  /* Недоступность выражается цветом, а не прозрачностью: своего токена
     на неё у нас нет и заводить его незачем (задача 63). */
  .action:disabled {
    color: var(--zn-color-fg-subtle);
    cursor: default;
  }

  .empty {
    margin: 0;
    padding: var(--zn-space-2) var(--zn-space-4) 0;
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui);
  }

  .hint {
    margin: 0;
    padding: var(--zn-space-1) var(--zn-space-4) 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
    overflow-wrap: anywhere;
  }

  /* Раздел шаблонов прижат к низу панели: дерево — главное, заготовки —
     справочная полка под ним. Высота ограничена, список прокручивается:
     заготовок бывает десяток, а дерево терять из виду нельзя. */
  .templates {
    flex: none;
    display: flex;
    flex-direction: column;
    max-height: 40%;
    border-top: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .list {
    margin: 0;
    padding: 0 0 var(--zn-space-2);
    list-style: none;
    overflow: auto;
  }

  .row {
    display: flex;
    align-items: center;
    height: var(--zn-control-row-height);
  }

  .row:hover {
    background-color: var(--zn-color-bg-hover);
  }

  .name {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 var(--zn-space-2) 0 var(--zn-space-4);
    border: none;
    background: transparent;
    color: var(--zn-color-fg-default);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Вторая кнопка строки видна только под курсором: она про редкое действие,
     и в спокойном списке ей делать нечего. Тот же приём, что у кнопок
     корня в дереве. */
  .row .action {
    visibility: hidden;
  }

  .row:hover .action,
  .row .action:focus-visible {
    visibility: visible;
  }

  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--zn-color-accent);
    font: inherit;
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }
</style>
