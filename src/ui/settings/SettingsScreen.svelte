<script lang="ts">
  import { onMount } from 'svelte';
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import Icon from '../Icon.svelte';
  import { settings, put } from '../../state/settings.svelte';
  import { refreshVault } from '../../state/roots.svelte';
  import * as ipc from '../../ipc/files';
  import { languages as loadLanguages, type LanguagesState } from '../../ipc/l10n';
  import { openDropped } from '../../actions/files';
  import { showAbout } from '../../actions/about';
  import { createTranslation, openTranslationsDir, restartApp } from '../../actions/language';
  import { language, languageName, t } from '../../l10n';
  import { version } from '../../version';
  import KeysScreen from './KeysScreen.svelte';
  import AppearanceScreen from './AppearanceScreen.svelte';
  import ToolbarScreen from './ToolbarScreen.svelte';
  import CalloutsScreen from './CalloutsScreen.svelte';
  import { updates, checkForUpdates } from '../../state/updates.svelte';
  import { placeOf, valueOf, defaultFolder, type PlaceKind } from './attachments';

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
   * и «отменить» нет: файл и есть состояние (Р-077). Исключение одно —
   * язык (задача 153): он выбирается при старте, и новый действует после
   * перезапуска, поэтому рядом с выбором встаёт кнопка «Перезапустить».
   */

  /**
   * Клавиши — отдельной вкладкой, а не строками среди прочего.
   *
   * Команд около шестидесяти, и списком такой длины они утопили бы в себе
   * пять настроек оформления. Разделение просил владелец: «чтобы не мусорить
   * в основных настройках».
   */
  let tab = $state<'general' | 'appearance' | 'keys' | 'toolbar' | 'callouts'>('general');

  const file = $derived(settings.state);
  const values = $derived(file?.settings);
  const broken = $derived(file?.broken ?? null);

  /**
   * Языки для выбора (задача 153): встроенные и свои файлы из папки
   * переводов. Список спрашивается у ядра при показе экрана и после
   * создания нового перевода — папку могли пополнить и руками.
   */
  let langs = $state<LanguagesState | null>(null);

  async function refreshLanguages(): Promise<void> {
    langs = await loadLanguages();
  }

  onMount(() => {
    void refreshLanguages();
  });

  /** Язык, который выбран в файле, — `auto` раскрыт в тот, что выберет запуск. */
  const chosen = $derived.by(() => {
    const setting = values?.appearance.language ?? 'auto';
    return setting === 'auto' ? (langs?.auto ?? null) : setting;
  });

  /** Выбран не тот язык, на котором окно говорит сейчас, — нужен перезапуск. */
  const needsRestart = $derived(chosen !== null && chosen.toLowerCase() !== language().toLowerCase());

  /** Код в файле, которого нет в списке (файл перевода убрали), — всё равно показать. */
  const unlisted = $derived.by(() => {
    const setting = values?.appearance.language ?? 'auto';
    if (setting === 'auto' || !langs) return null;
    return langs.languages.some((lang) => lang.code.toLowerCase() === setting.toLowerCase()) ? null : setting;
  });

  function languageLabel(code: string, builtin: boolean, coverage: number): string {
    const name = languageName(code);
    return builtin || coverage >= 100 ? name : t('settings.language.coverage', { language: name, percent: coverage });
  }

  async function newTranslation(): Promise<void> {
    if (await createTranslation()) await refreshLanguages();
  }

  /**
   * Папка вложений (задача 146): строка файла — выбор из четырёх и имя.
   * Имя спрашивается отдельной строкой и только там, где оно что-то значит.
   */
  const place = $derived(placeOf(values?.notes.attachments ?? './'));

  function setPlaceKind(kind: PlaceKind): void {
    void put(['notes', 'attachments'], valueOf({ kind, name: place.name }));
  }

  function setPlaceName(name: string): void {
    void put(['notes', 'attachments'], valueOf({ kind: place.kind, name }));
  }

  async function openFile(): Promise<void> {
    if (file) await openDropped([file.path]);
  }

  /**
   * Папка и шаблон ежедневной заметки (задача 90).
   *
   * Путь и набирают руками, и выбирают кнопкой: набрать быстрее, когда он
   * известен, а выбрать — единственный способ не ошибиться в чужой папке.
   * Пустая строка означает умолчание, и это сказано подсказкой в поле.
   */
  /**
   * Папка заметок — дом для записей (задача 94).
   *
   * После правки ядро приводит к ней реестр корней: панель «Заметки»
   * показывает новую папку сразу, без перезапуска.
   */
  async function pickVault(): Promise<void> {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === 'string') await setVault(picked);
  }

  async function setVault(path: string): Promise<void> {
    await put(['notes', 'vault'], path);
    await refreshVault();
  }

  async function pickDailyFolder(): Promise<void> {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === 'string') void put(['notes', 'daily_folder'], picked);
  }

  /** Папка заготовок (задача 95). Путь внутри дома либо абсолютный. */
  async function pickTemplatesFolder(): Promise<void> {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === 'string') void put(['notes', 'templates'], picked);
  }

  async function pickDailyTemplate(): Promise<void> {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: t('settings.daily-template.filter'), extensions: ['md', 'markdown', 'txt'] }],
    });
    if (typeof picked === 'string') void put(['notes', 'daily_template'], picked);
  }

  /**
   * Назначить ZeroNote умолчанием.
   *
   * Кнопка ведёт на страницу параметров Windows, а не назначает сама: с
   * Windows 10 умолчание защищено, и программа его не забирает (Р-190).
   * Установщик регистрирует нас как приложение — эта страница и есть то место,
   * где человек одним нажатием делает нас умолчанием для `.md`.
   */
  async function chooseDefaults(): Promise<void> {
    try {
      await ipc.openDefaultApps();
      settings.problem = null;
    } catch (error) {
      settings.problem = String(error);
    }
  }

  function subtitle(which: typeof tab): string {
    switch (which) {
      case 'general':
        return t('settings.subtitle.general');
      case 'appearance':
        return t('settings.subtitle.appearance');
      case 'toolbar':
        return t('settings.subtitle.toolbar');
      case 'callouts':
        return t('settings.subtitle.callouts');
      case 'keys':
        return t('settings.subtitle.keys');
    }
  }
</script>

<div class="screen">
  <div class="page">
    <header class="head">
      <h1 class="title">{t('settings.title')}</h1>
      <p class="subtitle">{subtitle(tab)}</p>
    </header>

    <div class="tabs">
      <button
        class="tab"
        class:current={tab === 'general'}
        type="button"
        onclick={() => (tab = 'general')}
      >
        {t('settings.tab.general')}
      </button>
      <button
        class="tab"
        class:current={tab === 'appearance'}
        type="button"
        onclick={() => (tab = 'appearance')}
      >
        {t('settings.tab.appearance')}
      </button>
      <button
        class="tab"
        class:current={tab === 'keys'}
        type="button"
        onclick={() => (tab = 'keys')}
      >
        {t('settings.tab.keys')}
      </button>
      <!-- Своя вкладка, а не строки в «Настройках» (решение владельца):
           состав панели — список в три десятка строк, и среди настроек
           редактора он утопил бы всё остальное. -->
      <button
        class="tab"
        class:current={tab === 'toolbar'}
        type="button"
        onclick={() => (tab = 'toolbar')}
      >
        {t('settings.tab.toolbar')}
      </button>
      <button
        class="tab"
        class:current={tab === 'callouts'}
        type="button"
        onclick={() => (tab = 'callouts')}
      >
        {t('settings.tab.callouts')}
      </button>
    </div>

    {#if tab === 'keys'}
      <KeysScreen />
    {:else if tab === 'toolbar'}
      <ToolbarScreen />
    {:else if tab === 'callouts'}
      <CalloutsScreen />
    {:else if tab === 'appearance'}
      <AppearanceScreen />
    {:else}
    {#if broken}
      <p class="broken">
        <Icon name="status.warning" />
        {broken}
      </p>
    {:else}
      <!-- Что не применилось — списком, но окно при этом не запирается:
           остальное прочитано и действует (Р-248). До задачи 101 одна
           опечатка в любом ключе делала все параметры только для чтения. -->
      {#if file && file.problems.length > 0}
        <div class="broken problems">
          <Icon name="status.warning" />
          <div>
            <p class="lead">{t('settings.problems')}</p>
            <ul>
              {#each file.problems as problem (problem)}
                <li>{problem}</li>
              {/each}
            </ul>
          </div>
        </div>
      {/if}
      {#if settings.problem}
        <p class="broken">
          <Icon name="status.warning" />
          {settings.problem}
        </p>
      {/if}
    {/if}

    {#if values}
      <div class="rows" class:frozen={broken !== null}>
        <!-- Язык — первым (задача 153): по-чужому написанное окно читать
             трудно, и выбор должен найтись без чтения. Поэтому каждый язык
             назван на самом себе. -->
        <div class="row">
          <div class="what">
            <span class="name">{t('settings.language')}</span>
            <span class="note">{t('settings.language.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null || langs === null}
            value={values.appearance.language}
            onchange={(e) => put(['appearance', 'language'], e.currentTarget.value)}
          >
            <option value="auto">
              {t('settings.language.auto', { language: langs ? languageName(langs.auto) : '…' })}
            </option>
            {#each langs?.languages ?? [] as lang (lang.code)}
              <option value={lang.code}>{languageLabel(lang.code, lang.builtin, lang.coverage)}</option>
            {/each}
            {#if unlisted}
              <option value={unlisted}>{unlisted}</option>
            {/if}
          </select>
        </div>

        {#if needsRestart && chosen}
          <div class="row restart">
            <span class="note">{t('settings.language.restart.note', { language: languageName(chosen) })}</span>
            <button class="button" type="button" onclick={() => void restartApp()}>
              {t('settings.language.restart')}
            </button>
          </div>
        {/if}

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.wrap')}</span>
            <span class="note">{t('settings.wrap.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.wrap ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'wrap'], e.currentTarget.value === 'yes')}
          >
            <option value="no">{t('settings.wrap.off')}</option>
            <option value="yes">{t('settings.wrap.on')}</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.auto-close')}</span>
            <span class="note">{t('settings.auto-close.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.auto_close ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'auto_close'], e.currentTarget.value === 'yes')}
          >
            <option value="yes">{t('settings.auto-close.on')}</option>
            <option value="no">{t('settings.auto-close.off')}</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.indent')}</span>
            <span class="note">{t('settings.indent.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.indent_style}
            onchange={(e) => put(['editor', 'indent_style'], e.currentTarget.value)}
          >
            <option value="spaces">{t('status.indent.spaces')}</option>
            <option value="tabs">{t('status.indent.tabs')}</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.indent-width')}</span>
            <span class="note">{t('settings.indent-width.note')}</span>
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
            <span class="name">{t('settings.invisibles')}</span>
            <span class="note">{t('settings.invisibles.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.invisibles ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'invisibles'], e.currentTarget.value === 'yes')}
          >
            <option value="no">{t('settings.option.hide')}</option>
            <option value="yes">{t('settings.option.show')}</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.line-numbers')}</span>
            <span class="note">{t('settings.line-numbers.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.line_numbers}
            onchange={(e) => put(['editor', 'line_numbers'], e.currentTarget.value)}
          >
            <option value="always">{t('settings.line-numbers.always')}</option>
            <option value="code">{t('settings.line-numbers.code')}</option>
            <option value="never">{t('settings.line-numbers.never')}</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.live-preview')}</span>
            <span class="note">{t('settings.live-preview.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.live_preview ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'live_preview'], e.currentTarget.value === 'yes')}
          >
            <option value="no">{t('settings.live-preview.off')}</option>
            <option value="yes">{t('settings.live-preview.on')}</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.note-title')}</span>
            <span class="note">{t('settings.note-title.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.note_title ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'note_title'], e.currentTarget.value === 'yes')}
          >
            <option value="no">{t('settings.option.hide')}</option>
            <option value="yes">{t('settings.option.show')}</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.readable')}</span>
            <span class="note">{t('settings.readable.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.readable_width ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'readable_width'], e.currentTarget.value === 'yes')}
          >
            <option value="no">{t('settings.readable.off')}</option>
            <option value="yes">{t('settings.readable.on')}</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.link-suggest')}</span>
            <span class="note">{t('settings.link-suggest.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.link_suggest ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'link_suggest'], e.currentTarget.value === 'yes')}
          >
            <option value="no">{t('settings.link-suggest.off')}</option>
            <option value="yes">{t('settings.link-suggest.on')}</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.autosave')}</span>
            <span class="note">{t('settings.autosave.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={values.editor.autosave ? 'yes' : 'no'}
            onchange={(e) => put(['editor', 'autosave'], e.currentTarget.value === 'yes')}
          >
            <option value="no">{t('settings.autosave.off')}</option>
            <option value="yes">{t('settings.autosave.on')}</option>
          </select>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.vault')}</span>
            <span class="note">{t('settings.vault.note')}</span>
          </div>
          <div class="control path">
            <input
              class="text"
              type="text"
              disabled={broken !== null}
              value={values.notes.vault}
              placeholder={t('settings.vault.empty')}
              spellcheck="false"
              onchange={(e) => void setVault(e.currentTarget.value.trim())}
            />
            <button
              class="pick"
              type="button"
              disabled={broken !== null}
              onclick={() => void pickVault()}>{t('settings.pick')}</button
            >
          </div>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.daily-folder')}</span>
            <span class="note">{t('settings.daily-folder.note')}</span>
          </div>
          <div class="control path">
            <input
              class="text"
              type="text"
              disabled={broken !== null}
              value={values.notes.daily_folder}
              placeholder={t('settings.daily-folder.empty')}
              spellcheck="false"
              onchange={(e) => put(['notes', 'daily_folder'], e.currentTarget.value.trim())}
            />
            <button
              class="pick"
              type="button"
              disabled={broken !== null}
              onclick={() => void pickDailyFolder()}>{t('settings.pick')}</button
            >
          </div>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.daily-template')}</span>
            <span class="note">{t('settings.daily-template.note')}</span>
          </div>
          <div class="control path">
            <input
              class="text"
              type="text"
              disabled={broken !== null}
              value={values.notes.daily_template}
              placeholder={t('settings.daily-template.empty')}
              spellcheck="false"
              onchange={(e) => put(['notes', 'daily_template'], e.currentTarget.value.trim())}
            />
            <button
              class="pick"
              type="button"
              disabled={broken !== null}
              onclick={() => void pickDailyTemplate()}>{t('settings.pick')}</button
            >
          </div>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.templates')}</span>
            <span class="note">{t('settings.templates.note')}</span>
          </div>
          <div class="control path">
            <input
              class="text"
              type="text"
              disabled={broken !== null}
              value={values.notes.templates}
              placeholder={t('settings.templates.empty')}
              spellcheck="false"
              onchange={(e) => put(['notes', 'templates'], e.currentTarget.value.trim())}
            />
            <button
              class="pick"
              type="button"
              disabled={broken !== null}
              onclick={() => void pickTemplatesFolder()}>{t('settings.pick')}</button
            >
          </div>
        </div>

        <div class="row">
          <div class="what">
            <span class="name">{t('settings.attachments')}</span>
            <span class="note">{t('settings.attachments.note')}</span>
          </div>
          <select
            class="control"
            disabled={broken !== null}
            value={place.kind}
            onchange={(e) => setPlaceKind(e.currentTarget.value as PlaceKind)}
          >
            <option value="note">{t('settings.attachments.note-folder')}</option>
            <option value="beside">{t('settings.attachments.beside')}</option>
            <option value="root">{t('settings.attachments.root')}</option>
            <option value="folder">{t('settings.attachments.folder')}</option>
          </select>
        </div>

        {#if place.kind === 'beside' || place.kind === 'folder'}
          <div class="row">
            <div class="what">
              <span class="name">{t('settings.attachments.name')}</span>
              <span class="note">
                {place.kind === 'beside'
                  ? t('settings.attachments.name.beside')
                  : t('settings.attachments.name.folder')}
              </span>
            </div>
            <div class="control path">
              <input
                class="text"
                type="text"
                disabled={broken !== null}
                value={place.name}
                placeholder={defaultFolder()}
                spellcheck="false"
                onchange={(e) => setPlaceName(e.currentTarget.value)}
              />
            </div>
          </div>
        {/if}

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
        <button class="button" type="button" onclick={openFile}>{t('settings.file.open')}</button>
      </div>

      <!-- Свой перевод (задача 153, просьба владельца): файл в папке данных,
           подхватывается перезапуском, без пересборки. «Создать» кладёт
           копию таблицы строк — переводить есть с чего. -->
      <div class="card stacked">
        <span class="card-icon"><Icon name="action.project-file" /></span>
        <div class="what">
          <span class="name">{t('translation.card')}</span>
          <span class="note">{t('translation.card.note')}</span>
          {#if langs}
            <span class="note path">{langs.dir}</span>
          {/if}
        </div>
        <div class="buttons">
          <button class="button quiet" type="button" onclick={() => void openTranslationsDir()}>
            {t('translation.folder')}
          </button>
          <button class="button" type="button" onclick={() => void newTranslation()}>
            {t('translation.create')}
          </button>
        </div>
      </div>

      <!-- Умолчание для типа файла назначает человек, и назначает в системе:
           Windows не даёт программе забрать тип себе (Р-190). Наше дело —
           довести до нужной страницы одним нажатием. -->
      <div class="card">
        <span class="card-icon"><Icon name="file.markdown" /></span>
        <div class="what">
          <span class="name">{t('settings.defaults')}</span>
          <span class="note">{t('settings.defaults.note')}</span>
        </div>
        <button class="button" type="button" onclick={chooseDefaults}>{t('settings.defaults.button')}</button>
      </div>

      <p class="footer">{t('settings.footer')}</p>
    {/if}

    <!-- Снаружи проверки на разобранный файл: на вопрос «какая у вас версия»
         надо отвечать и тогда, когда settings.toml испорчен. Иначе версия
         прячется ровно в том случае, когда её и спрашивают. -->
    <div class="card">
      <span class="card-icon mark"><Icon name="app.mark" /></span>
      <div class="what">
        <span class="name">ZeroNote {version}</span>
        <span class="note">{t('settings.about.license')}</span>
      </div>
      <!-- Единственная кнопка в приложении, открывающая сетевое соединение
           (Р-118). Проверка идёт только по нажатию, установка — по второму. -->
      <button
        class="button quiet"
        type="button"
        disabled={updates.busy}
        onclick={checkForUpdates}
      >
        {updates.busy ? t('settings.updates.checking') : t('settings.updates')}
      </button>
      <button class="button" type="button" onclick={showAbout}>{t('settings.about')}</button>
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

  /* Колонка по центру рабочей области — просьба владельца. При широком окне
     параметры прижимались к левому краю, а правая половина пустовала.
     Способ тот же, каким встаёт по центру читаемая ширина редактора (Р-156):
     ширина ограничена, а поля делятся поровну. */
  .page {
    max-width: var(--zn-control-page-width);
    margin-inline: auto;
    padding: var(--zn-space-6);
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

  /* Список жалоб: значок у первой строки, а не посередине списка. */
  .problems {
    align-items: flex-start;
  }

  .problems .lead {
    margin: 0;
  }

  .problems ul {
    margin: var(--zn-space-1) 0 0 0;
    padding-left: var(--zn-space-5);
  }

  .control.path {
    display: flex;
    gap: var(--zn-space-2);
    align-items: center;
  }

  .control.path .text {
    flex: 1;
    min-width: 0;
  }

  .pick {
    flex: none;
    padding: var(--zn-space-1) var(--zn-space-3);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-sm);
    background-color: var(--zn-color-bg-raised);
    color: var(--zn-color-fg-default);
    font-family: var(--zn-font-family-ui);
    font-size: var(--zn-font-size-ui);
    cursor: default;
  }

  .pick:hover:not(:disabled) {
    background-color: var(--zn-color-bg-hover);
  }

  .pick:disabled {
    color: var(--zn-color-fg-subtle);
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

  /* Карточка своего перевода (задача 153) — кнопки строкой под текстом:
     их две, и рядом с текстом в узкой области он сжимался до слова
     в строке. Текст с плиткой значка занимает первую строку целиком. */
  .card.stacked {
    flex-wrap: wrap;
  }

  .card.stacked .what {
    flex-basis: calc(100% - var(--zn-control-strip-button-size) - var(--zn-space-4));
  }

  .card.stacked .buttons {
    display: flex;
    gap: var(--zn-space-2);
    margin-left: auto;
  }

  /* Перезапуск ради языка (задача 153) — строкой сразу под выбором:
     видно, что выбор ещё не действует и чем его применить. */
  .row.restart {
    justify-content: space-between;
  }

  .footer {
    margin: var(--zn-space-5) 0 0 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }
</style>
