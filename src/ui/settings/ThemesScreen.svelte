<script lang="ts">
  import Icon from '../Icon.svelte';
  import { settings, put } from '../../state/settings.svelte';
  import { appearance, refresh } from '../../theme/store.svelte';
  import * as ipc from '../../ipc/appearance';
  import type { ThemeInfo, ThemeSample } from '../../ipc/appearance';
  import { choiceFor, followsSystem, grouped, stateOf, type ThemeSelection } from './themes';

  /**
   * Вкладка «Темы».
   *
   * Тема, которой у нас нет, не должна быть задачей разработки (Р-147):
   * механика темы-файла есть с этапа 3, не хватало места, где это видно.
   * Отсюда три вещи на экране: список с образцом, «создать свою на основе
   * этой» и «открыть папку тем».
   *
   * Образец рисуется настоящими цветами темы, а не описанием: проверку
   * читаемости мы прогоняем только на встроенных, и у чужой темы единственный
   * судья — глаз. Поэтому цвета считает ядро (`theme::samples`), а карточка
   * просто их показывает.
   */

  const values = $derived(settings.state?.settings);
  const broken = $derived(settings.state?.broken ?? null);
  // Не `state`: за этим именем в Svelte стоит руна, и `$state` рядом
  // разбирается как подписка на хранилище `state`.
  const look = $derived(appearance.current);
  const themes = $derived(look?.themes ?? []);
  const groups = $derived(grouped(themes));

  const selection = $derived<ThemeSelection>({
    theme: values?.appearance.theme ?? 'system',
    lightTheme: values?.appearance.light_theme ?? 'light',
    darkTheme: values?.appearance.dark_theme ?? 'dark',
    currentId: look?.themeId ?? '',
  });

  let samples = $state<Record<string, ThemeSample>>({});
  let problem = $state<string | null>(null);

  /**
   * Образцы перезапрашиваются на каждое изменение оформления.
   *
   * За папкой тем следит ядро и присылает событие, поэтому правка цвета
   * в файле обязана быть видна на карточке — иначе «открыть папку тем»
   * заканчивается перезапуском приложения.
   */
  $effect(() => {
    void look;
    void loadSamples();
  });

  async function loadSamples(): Promise<void> {
    try {
      const list = await ipc.themeSamples();
      samples = Object.fromEntries(list.map((sample) => [sample.id, sample]));
    } catch (error) {
      // Образец — украшение: без него вкладка обязана остаться рабочей,
      // иначе тему нельзя будет сменить вовсе.
      samples = {};
      problem = String(error);
    }
  }

  /**
   * Смена темы применяется сразу, а не ожидается от слежения за файлами.
   *
   * Событие придёт и так, но с задержкой в полсекунды, и всё это время
   * пометка «применена» стояла бы на прошлой теме. То же соображение,
   * что во вкладке «Клавиши».
   */
  async function apply(key: string, value: string): Promise<void> {
    await put(['appearance', key], value);
    await refresh();
  }

  async function select(theme: ThemeInfo): Promise<void> {
    const choice = choiceFor(theme, selection);
    await apply(choice.key, choice.value);
  }

  /**
   * «Как в Windows» выключается в пользу той темы, что применена сейчас:
   * человек видит на экране её, и смена режима не должна менять вид окна.
   */
  async function setMode(mode: string): Promise<void> {
    await apply('theme', mode === 'system' ? 'system' : selection.currentId);
  }

  async function createFrom(): Promise<void> {
    problem = null;
    try {
      const created = await ipc.createTheme(selection.currentId);
      // Новая тема выбирается тем же правилом, что и щелчок по карточке:
      // при «Как в Windows» она встаёт своей парой, а не отменяет режим.
      const choice = choiceFor(created, selection);
      await apply(choice.key, choice.value);
    } catch (error) {
      problem = String(error);
    }
  }

  async function openFolder(): Promise<void> {
    problem = null;
    try {
      await ipc.openThemesDir();
    } catch (error) {
      problem = String(error);
    }
  }
</script>

<div class="themes">
  {#if problem}
    <p class="broken">
      <Icon name="status.warning" />
      {problem}
    </p>
  {/if}

  <div class="mode">
    <div class="what">
      <span class="name">Как выбирается тема</span>
      <span class="note">
        {followsSystem(selection)
          ? 'Щелчок по светлой теме назначает светлую пару, по тёмной — тёмную.'
          : 'Щелчок по теме применяет её сразу.'}
      </span>
    </div>
    <select
      class="control"
      disabled={broken !== null}
      value={followsSystem(selection) ? 'system' : 'fixed'}
      onchange={(e) => void setMode(e.currentTarget.value)}
    >
      <option value="fixed">Выбранная ниже</option>
      <option value="system">Как в Windows</option>
    </select>
  </div>

  {#each [{ title: 'Светлые', list: groups.light }, { title: 'Тёмные', list: groups.dark }] as group (group.title)}
    {#if group.list.length > 0}
      <section class="group">
        <h2 class="group-title">{group.title}</h2>
        <div class="cards">
          {#each group.list as theme (theme.id)}
            {@const mark = stateOf(theme, selection)}
            {@const sample = samples[theme.id]}
            <button
              class="card"
              class:current={mark.current}
              type="button"
              disabled={broken !== null}
              onclick={() => void select(theme)}
              title={theme.builtin ? 'Встроенная тема' : 'Своя тема из папки тем'}
            >
              <span
                class="sample"
                style:--sample-bg={sample?.bg}
                style:--sample-fg={sample?.fg}
                style:--sample-muted={sample?.muted}
                style:--sample-accent={sample?.accent}
                style:--sample-border={sample?.border}
                style:--sample-keyword={sample?.keyword}
                style:--sample-string={sample?.string}
                style:--sample-comment={sample?.comment}
              >
                <span class="sample-row">
                  <span class="dot"></span>
                  <span class="heading">Заголовок</span>
                </span>
                <span class="sample-row body">обычный текст</span>
                <span class="sample-row code">
                  <span class="keyword">fn</span>
                  <span class="string">«код»</span>
                  <span class="comment">// заметка</span>
                </span>
              </span>

              <span class="label">
                {#if mark.current}
                  <Icon name="action.check" />
                {/if}
                <span class="theme-name">{theme.name}</span>
                {#if !theme.builtin}
                  <span class="badge">своя</span>
                {/if}
                {#if mark.pair}
                  <span class="badge">{mark.pair === 'light' ? 'светлая' : 'тёмная'}</span>
                {/if}
              </span>
            </button>
          {/each}
        </div>
      </section>
    {/if}
  {/each}

  <div class="actions">
    <button
      class="action"
      type="button"
      disabled={broken !== null || selection.currentId === ''}
      onclick={() => void createFrom()}
    >
      Создать свою на основе «{look?.themeName ?? ''}»
    </button>
    <button class="action" type="button" onclick={() => void openFolder()}>
      Открыть папку тем
    </button>
  </div>

  <p class="hint">
    Тема — файл TOML в папке тем. Копия сохраняет пояснения к палитре, и её
    можно править как обычный текст: сохраните файл — окно перерисуется само.
    Проверку читаемости мы прогоняем только на встроенных темах, так что
    за своей смотрите глазами.
  </p>
</div>

<style>
  .themes {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-4);
  }

  .broken {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    margin: 0;
    padding: var(--zn-space-3) var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-warning);
    border-radius: var(--zn-radius-lg);
    color: var(--zn-color-warning);
  }

  .mode {
    display: flex;
    align-items: center;
    gap: var(--zn-space-4);
  }

  .what {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-1);
    flex: 1;
    min-width: 0;
  }

  .name {
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-ui);
  }

  .note {
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .control {
    flex: none;
    height: var(--zn-control-field-height);
    padding-inline: var(--zn-space-3);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-bg-canvas);
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-2);
  }

  .group-title {
    margin: 0;
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
    font-weight: var(--zn-font-weight-strong);
    text-transform: uppercase;
    letter-spacing: var(--zn-font-letter-spacing-caps);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--zn-control-theme-card-width), 1fr));
    gap: var(--zn-space-3);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-2);
    padding: var(--zn-space-2);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-lg);
    background-color: var(--zn-color-bg-surface);
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    text-align: left;
    cursor: pointer;
  }

  .card:hover:not(:disabled) {
    border-color: var(--zn-color-border-focus);
  }

  /* Недоступность выражается цветом, а не прозрачностью — так во всём
     интерфейсе с этапа 3 (см. Popup). */
  .card:disabled {
    cursor: default;
    color: var(--zn-color-fg-subtle);
  }

  /* Выбранная тема обведена акцентом изнутри: рамка другой толщины сдвинула бы
     карточку на пиксель, и ряд ехал бы при каждом выборе. */
  .card.current {
    border-color: var(--zn-color-accent);
    box-shadow: inset 0 0 0 var(--zn-border-width) var(--zn-color-accent);
  }

  .card:focus-visible {
    outline: var(--zn-border-width-thick) solid var(--zn-color-border-focus);
    outline-offset: var(--zn-border-width);
  }

  /* Образец: цвета приходят из темы, размеры — из токенов. Запасные значения
     нужны на случай, когда образцы не пришли: карточка остаётся рабочей. */
  .sample {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-1);
    padding: var(--zn-space-3);
    border: var(--zn-border-width) solid var(--sample-border, var(--zn-color-border-subtle));
    border-radius: var(--zn-radius-md);
    background-color: var(--sample-bg, var(--zn-color-bg-canvas));
    font-size: var(--zn-font-size-ui-small);
    overflow: hidden;
  }

  .sample-row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    color: var(--sample-fg, var(--zn-color-fg-default));
    white-space: nowrap;
  }

  .dot {
    width: var(--zn-space-2);
    height: var(--zn-space-2);
    flex: none;
    border-radius: var(--zn-radius-sm);
    background-color: var(--sample-accent, var(--zn-color-accent));
  }

  .heading {
    font-weight: var(--zn-font-weight-strong);
  }

  .body {
    color: var(--sample-muted, var(--zn-color-fg-muted));
  }

  .code {
    font-family: var(--zn-font-family-editor);
  }

  .keyword {
    color: var(--sample-keyword, var(--zn-color-syntax-keyword));
  }

  .string {
    color: var(--sample-string, var(--zn-color-syntax-string));
  }

  .comment {
    color: var(--sample-comment, var(--zn-color-syntax-comment));
  }

  /* Подписи переносятся, а не сжимают имя: у длинного имени с двумя
     подписями рядом от него оставалось «One Dark (к…», а имя — то, по чему
     тему узнают. */
  .label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--zn-space-2);
    min-width: 0;
  }

  .theme-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* Подпись роли — «своя», «светлая». Тише имени: имя ищут, роль замечают. */
  .badge {
    flex: none;
    padding-inline: var(--zn-space-2);
    border-radius: var(--zn-radius-sm);
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--zn-space-3);
  }

  .action {
    height: var(--zn-control-field-height);
    padding-inline: var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-bg-raised);
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    cursor: pointer;
  }

  .action:hover:not(:disabled) {
    background-color: var(--zn-color-bg-hover);
  }

  .action:disabled {
    cursor: default;
    color: var(--zn-color-fg-subtle);
  }

  .hint {
    margin: 0;
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
  }
</style>
