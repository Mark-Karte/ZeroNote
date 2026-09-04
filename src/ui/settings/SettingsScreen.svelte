<script lang="ts">
  import Icon from '../Icon.svelte';
  import { settings, put } from '../../state/settings.svelte';
  import { appearance } from '../../theme/store.svelte';
  import { openDropped } from '../../actions/files';
  import { showAbout } from '../../actions/about';
  import { version } from '../../version';
  import KeysScreen from './KeysScreen.svelte';
  import { updates, checkForUpdates } from '../../state/updates.svelte';

  /**
   * Экран параметров.
   *
   * Показывает НАШИ ключи из `settings.toml`, а не список из дизайн-референса:
   * там есть превью markdown, которого у нас нет. Настройка, которой
   * не существует, в окне параметров — это обещание, которое некому
   * выполнить. Автосохранение из того же списка появилось задачей 51,
   * и появилось выключенным (Р-133).
   *
   * Изменение применяется сразу и пишется в файл. Кнопок «применить»
   * и «отменить» нет: файл и есть состояние (Р-077).
   */

  /**
   * Клавиши — отдельной вкладкой, а не строками среди прочего.
   *
   * Команд около шестидесяти, и списком такой длины они утопили бы в себе
   * пять настроек оформления. Разделение просил владелец: «чтобы не мусорить
   * в основных настройках».
   */
  let tab = $state<'general' | 'keys'>('general');

  const file = $derived(settings.state);
  const values = $derived(file?.settings);
  const broken = $derived(file?.broken ?? null);

  /** Темы, доступные для выбора. Приходят из того же места, что и оформление. */
  const themes = $derived(appearance.current?.themes ?? []);
  const light = $derived(themes.filter((t) => t.appearance === 'light'));
  const dark = $derived(themes.filter((t) => t.appearance === 'dark'));

  const followsSystem = $derived(values?.appearance.theme === 'system');

  /** Пустая строка в поле шрифта означает «как в теме», то есть убрать ключ. */
  function fontFamily(text: string): void {
    const trimmed = text.trim();
    void put(['font', 'ui', 'family'], trimmed === '' ? null : trimmed);
  }

  function fontSize(text: string): void {
    const trimmed = text.trim();
    if (trimmed === '') {
      void put(['font', 'ui', 'size'], null);
      return;
    }
    const size = Number.parseInt(trimmed, 10);
    // Число вне разумного диапазона в файл не пойдёт: интерфейс с шрифтом
    // в два пикселя починить через этот же интерфейс уже не выйдет.
    if (Number.isFinite(size) && size >= 8 && size <= 32) {
      void put(['font', 'ui', 'size'], size);
    }
  }

  async function openFile(): Promise<void> {
    if (file) await openDropped([file.path]);
  }
</script>

<div class="screen">
  <div class="page">
    <header class="head">
      <h1 class="title">Параметры</h1>
      <p class="subtitle">
        {tab === 'general'
          ? 'Оформление · Шрифт · Файл настроек · О программе'
          : 'Горячие клавиши · keymap.toml'}
      </p>
    </header>

    <div class="tabs">
      <button
        class="tab"
        class:current={tab === 'general'}
        type="button"
        onclick={() => (tab = 'general')}
      >
        Настройки
      </button>
      <button
        class="tab"
        class:current={tab === 'keys'}
        type="button"
        onclick={() => (tab = 'keys')}
      >
        Клавиши
      </button>
    </div>

    {#if tab === 'keys'}
      <KeysScreen />
    {:else}
    {#if broken}
      <p class="broken">
        <Icon name="status.warning" />
        {broken}
      </p>
    {:else if settings.problem}
      <p class="broken">
        <Icon name="status.warning" />
        {settings.problem}
      </p>
    {/if}

    {#if values}
      <div class="rows" class:frozen={broken !== null}>
        <div class="row">
          <div class="what">
            <span class="name">Тема оформления</span>
            <span class="note">
              «Как в Windows» переключает пару тем вслед за системной настройкой.
            </span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.appearance.theme}
            onchange={(e) => put(['appearance', 'theme'], e.currentTarget.value)}
          >
            <option value="system">Как в Windows</option>
            {#each themes as theme (theme.id)}
              <option value={theme.id}>{theme.name}</option>
            {/each}
          </select>
        </div>

        {#if followsSystem}
          <div class="row">
            <div class="what">
              <span class="name">Светлая тема</span>
              <span class="note">Когда Windows в светлом оформлении.</span>
            </div>
            <select
              class="control"
              disabled={broken !== null}
              value={values.appearance.light_theme}
              onchange={(e) => put(['appearance', 'light_theme'], e.currentTarget.value)}
            >
              {#each light as theme (theme.id)}
                <option value={theme.id}>{theme.name}</option>
              {/each}
            </select>
          </div>

          <div class="row">
            <div class="what">
              <span class="name">Тёмная тема</span>
              <span class="note">Когда Windows в тёмном оформлении.</span>
            </div>
            <select
              class="control"
              disabled={broken !== null}
              value={values.appearance.dark_theme}
              onchange={(e) => put(['appearance', 'dark_theme'], e.currentTarget.value)}
            >
              {#each dark as theme (theme.id)}
                <option value={theme.id}>{theme.name}</option>
              {/each}
            </select>
          </div>
        {/if}

        <div class="row">
          <div class="what">
            <span class="name">Плотность интерфейса</span>
            <span class="note">
              Компактная уменьшает высоты строк, отступы и размер шрифта.
            </span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.appearance.density}
            onchange={(e) => put(['appearance', 'density'], e.currentTarget.value)}
          >
            <option value="normal">Обычная</option>
            <option value="compact">Компактная</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">Перенос длинных строк</span>
            <span class="note">
              Переключается и в строке состояния — там же, где кодировка.
            </span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.wrap ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'wrap'], e.currentTarget.value === 'yes')}
          >
            <option value="no">Не переносить</option>
            <option value="yes">Переносить по ширине окна</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">Закрывать скобки при наборе</span>
            <span class="note">
              В прозе — markdown и обычном тексте — кавычки не закрываются
              и при включённой настройке: там они не парные.
            </span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.auto_close ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'auto_close'], e.currentTarget.value === 'yes')}
          >
            <option value="yes">Закрывать</option>
            <option value="no">Не закрывать</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">Отступ по умолчанию</span>
            <span class="note">
              Только для файлов, где отступов нет: в остальных он определяется
              по содержимому и виден в строке состояния.
            </span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.indent_style}
            onchange={(e) => put(['editor', 'indent_style'], e.currentTarget.value)}
          >
            <option value="spaces">Пробелы</option>
            <option value="tabs">Табы</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">Ширина отступа</span>
            <span class="note">
              Сколько пробелов в отступе или во сколько столбцов рисуется таб.
            </span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={String(values.editor.indent_width)}
            onchange={(e) => put(['editor', 'indent_width'], Number(e.currentTarget.value))}
          >
            <option value="2">2</option>
            <option value="4">4</option>
            <option value="8">8</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">Невидимые символы</span>
            <span class="note">
              Пробелы точкой, табуляции стрелкой, переносы знаком абзаца.
            </span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.invisibles ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'invisibles'], e.currentTarget.value === 'yes')}
          >
            <option value="no">Не показывать</option>
            <option value="yes">Показывать</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">Панель разметки markdown</span>
            <span class="note">
              Жирный, курсив, заголовки, списки, ссылка и заготовки. Появляется
              только над markdown; всё то же есть в палитре команд.
            </span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.markdown_bar ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'markdown_bar'], e.currentTarget.value === 'yes')}
          >
            <option value="no">Не показывать</option>
            <option value="yes">Показывать</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">Подсказка имён при [[</span>
            <span class="note">
              Список заметок проекта после двух скобок в markdown. Автодополнением
              кода ZeroNote не занимается.
            </span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.link_suggest ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'link_suggest'], e.currentTarget.value === 'yes')}
          >
            <option value="no">Не подсказывать</option>
            <option value="yes">Подсказывать</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">Автосохранение</span>
            <span class="note">
              Писать правки в файл через две секунды после последней и когда
              окно теряет фокус. Черновики работают всегда и от этого
              не зависят.
            </span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.autosave ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'autosave'], e.currentTarget.value === 'yes')}
          >
            <option value="no">Только по команде</option>
            <option value="yes">Сохранять само</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">Шрифт интерфейса</span>
            <span class="note">Пусто — из темы. Шрифт редактора задаёт тема.</span>
          </div>
          <input
            class="control text"
            type="text"
            disabled={broken !== null}
            value={values.font.ui.family ?? ''}
            placeholder="как в теме"
            spellcheck="false"
            onchange={(e) => fontFamily(e.currentTarget.value)}
          />
        </div>

        <div class="row">
          <div class="what">
            <span class="name">Размер шрифта интерфейса</span>
            <span class="note">От 8 до 32 пикселей. Пусто — из темы.</span>
          </div>
          <input
            class="control number"
            type="number"
            min="8"
            max="32"
            disabled={broken !== null}
            value={values.font.ui.size ?? ''}
            placeholder="как в теме"
            onchange={(e) => fontSize(e.currentTarget.value)}
          />
        </div>
      </div>

      <!-- Файл — основной интерфейс настройки, а это окно — надстройка над ним.
           Поэтому путь показан, а файл открывается здесь же: мы редактор,
           и звать для этого чужую программу было бы странно. -->
      <div class="card">
        <span class="card-icon"><Icon name="action.project-file" /></span>
        <div class="what">
          <span class="name">settings.toml</span>
          <span class="note path">{file?.path}</span>
        </div>
        <button class="button" type="button" onclick={openFile}>Открыть</button>
      </div>

      <p class="footer">
        Всё, что есть в окне, есть и в файле. Файл можно править руками
        и класть в git — изменения подхватываются на лету.
      </p>
    {/if}

    <!-- Снаружи проверки на разобранный файл: на вопрос «какая у вас версия»
         надо отвечать и тогда, когда settings.toml испорчен. Иначе версия
         прячется ровно в том случае, когда её и спрашивают. -->
    <div class="card">
      <span class="card-icon mark"><Icon name="app.mark" /></span>
      <div class="what">
        <span class="name">ZeroNote {version}</span>
        <span class="note">Свободная программа под лицензией MIT.</span>
      </div>
      <!-- Единственная кнопка в приложении, открывающая сетевое соединение
           (Р-118). Проверка идёт только по нажатию, установка — по второму. -->
      <button
        class="button quiet"
        type="button"
        disabled={updates.busy}
        onclick={checkForUpdates}
      >
        {updates.busy ? 'Проверяю…' : 'Обновления'}
      </button>
      <button class="button" type="button" onclick={showAbout}>Сведения</button>
    </div>
    {/if}
  </div>
</div>

<style>
  .screen {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .page {
    max-width: var(--zn-control-page-width);
    padding: var(--zn-space-6) var(--zn-space-6) var(--zn-space-6);
  }

  .head {
    margin-bottom: var(--zn-space-6);
  }

  .title {
    margin: 0;
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-title);
    font-weight: var(--zn-font-weight-strong);
    letter-spacing: var(--zn-font-letter-spacing-tight);
  }

  .subtitle {
    margin: var(--zn-space-2) 0 0 0;
    color: var(--zn-color-fg-subtle);
  }

  .tabs {
    display: flex;
    gap: var(--zn-space-2);
    margin-bottom: var(--zn-space-5);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .tab {
    padding: var(--zn-space-2) var(--zn-space-4);
    border: none;
    border-bottom: var(--zn-border-width-thick) solid transparent;
    background: none;
    color: var(--zn-color-fg-subtle);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    cursor: default;
  }

  .tab:hover {
    color: var(--zn-color-fg-default);
  }

  .tab.current {
    border-bottom-color: var(--zn-color-accent);
    color: var(--zn-color-fg-default);
  }

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

  .rows {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-5);
    padding-block: var(--zn-space-4);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .what {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: var(--zn-space-1);
  }

  .name {
    color: var(--zn-color-fg-default);
  }

  .note {
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .path {
    font-family: var(--zn-font-family-editor);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .control {
    flex: none;
    height: var(--zn-control-field-height);
    min-width: var(--zn-control-popup-min-width);
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

  .control:disabled {
    color: var(--zn-color-fg-subtle);
  }

  .number {
    min-width: var(--zn-control-tab-min-width);
  }

  .card {
    display: flex;
    align-items: center;
    gap: var(--zn-space-4);
    margin-top: var(--zn-space-6);
    padding: var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-lg);
    background-color: var(--zn-color-bg-surface);
  }

  /* Такая же плитка, как кнопка боковой полосы, — и значок в ней той же роли:
     в квадрате этого размера строчный значок теряется. */
  .card-icon {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    --zn-control-icon-size: var(--zn-control-icon-size-tile);
    width: var(--zn-control-strip-button-size);
    height: var(--zn-control-strip-button-size);
    border-radius: var(--zn-radius-xl);
    background-color: var(--zn-color-bg-selected);
    color: var(--zn-color-accent);
  }

  /* Знак приложения — единственная двухцветная иконка (Р-099): кольцо берёт
     currentColor, штрих внутри — акцент. Покрасить плитку акцентом целиком
     значило бы слить штрих с кольцом и потерять сам знак. */
  .card-icon.mark {
    color: var(--zn-color-fg-default);
  }

  .button {
    flex: none;
    height: var(--zn-control-field-height);
    padding-inline: var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-accent);
    border-radius: var(--zn-radius-lg);
    background-color: var(--zn-color-accent);
    color: var(--zn-color-fg-on-accent);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    cursor: default;
  }

  .button:hover {
    background-color: var(--zn-color-accent-hover);
    border-color: var(--zn-color-accent-hover);
  }

  /* Кнопка обновлений второстепенная: главное в карточке — версия. */
  .quiet {
    border-color: var(--zn-color-border-default);
    background-color: transparent;
    color: var(--zn-color-fg-default);
  }

  .quiet:hover:not(:disabled) {
    background-color: var(--zn-color-bg-hover);
    border-color: var(--zn-color-border-default);
  }

  .button:disabled {
    color: var(--zn-color-fg-subtle);
  }

  .footer {
    margin: var(--zn-space-5) 0 0 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }
</style>
