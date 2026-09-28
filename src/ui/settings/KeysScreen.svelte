<script lang="ts">
  import Icon from '../Icon.svelte';
  import { iconForCommand } from '../../icons/commands';
  import { labelOf } from '../../keymap/binding';
  import { chordVerdict, conflictFor, conflictQuestion } from '../../keymap/conflicts';
  import {
    applyKeymap,
    captureChords,
    commandTable,
    currentBindings,
    keymapBroken,
    keymapProblems,
  } from '../../keymap/global.svelte';
  import * as ipc from '../../ipc/keymap';
  import { askChoice } from '../../state/modal.svelte';
  import { t } from '../../l10n';

  /**
   * Редактор горячих клавиш — отдельной вкладкой окна параметров.
   *
   * Своего состояния почти нет: список команд, их сочетания и умолчания
   * приходят из ядра, туда же уезжает правка, оттуда же возвращается новая
   * раскладка. Как и окно параметров, это надстройка над файлом —
   * `keymap.toml` можно править руками, и результат будет тем же (Р-077).
   *
   * Ответ ядра занимается сразу, а не ожидается от слежения за файлами:
   * событие придёт и так, но с задержкой, и всё это время в строке стояло бы
   * вчерашнее сочетание рядом с только что нажатым.
   */

  const commands = $derived(commandTable());
  const broken = $derived(keymapBroken());
  const skipped = $derived(keymapProblems());

  let filter = $state('');
  /** Команда, для которой сейчас ждём нажатия. */
  let capturing = $state<string | null>(null);
  /** Нажатая клавиша набора: назначать её нельзя, говорим почему (С7). */
  let refused = $state<string | null>(null);
  let problem = $state<string | null>(null);

  /** Как вернуть клавиши приложению. Пока не вызвано — команды не работают. */
  let release: (() => void) | null = null;

  const titles = $derived(new Map(commands.map((command) => [command.id, command.title])));

  const shown = $derived(
    commands.filter((command) => {
      const needle = filter.trim().toLowerCase();
      if (needle === '') return true;
      if (command.title.toLowerCase().includes(needle)) return true;
      return command.bindings.some((binding) =>
        labelOf(binding).toLowerCase().includes(needle),
      );
    }),
  );

  /** Сочетания отличаются от умолчаний — значит, есть что сбрасывать. */
  function changed(command: { bindings: string[]; defaults: string[] }): boolean {
    return command.bindings.join(' ') !== command.defaults.join(' ');
  }

  function stopCapture(): void {
    release?.();
    release = null;
    capturing = null;
    refused = null;
  }

  /**
   * Захват обязательно снимается при уходе с вкладки.
   *
   * Иначе окно параметров закрылось бы посреди назначения, а приложение
   * осталось бы без горячих клавиш — и починить это было бы нечем,
   * потому что клавиши как раз и не работают.
   */
  $effect(() => stopCapture);

  function beginCapture(id: string): void {
    stopCapture();
    capturing = id;
    const captured = captureChords((binding) => {
      // Один модификатор сочетанием не является — человек ещё нажимает.
      if (binding === null) return;
      switch (chordVerdict(binding)) {
        case 'cancel':
          stopCapture();
          return;
        case 'typing':
          // Захват не снимаем: человек, скорее всего, ещё наберёт
          // настоящее сочетание, — а увидит, почему это не подошло.
          refused = binding;
          return;
        case 'take':
          stopCapture();
          void assign(id, binding);
      }
    });

    // Щелчок мимо строки снимает захват (С7 ревизии). Пока он включён,
    // диспетчер отдаёт ему **любое** нажатие в окне: до задачи 142 человек
    // щёлкал в поле поиска или в заметку соседней области, начинал
    // печатать — и первая буква становилась сочетанием. Клавиатурой фокус
    // во время захвата не увести: Tab тоже пойман. На стадии захвата —
    // раньше, чем щелчок дойдёт до цели.
    const onPointer = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-capturing]')) return;
      stopCapture();
    };
    window.addEventListener('pointerdown', onPointer, true);

    release = () => {
      captured();
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }

  async function apply(work: Promise<ipc.KeymapState>): Promise<void> {
    problem = null;
    try {
      applyKeymap(await work);
    } catch (error) {
      problem = String(error);
    }
  }

  /**
   * Назначить сочетание, спросив про занятое.
   *
   * Спрашиваем всегда, когда что-то теряется, — и называем, что именно.
   * Молча отнятое сочетание обнаруживается через неделю и не связывается
   * с этим окном.
   */
  async function assign(id: string, binding: string): Promise<void> {
    const conflict = conflictFor(binding, id, currentBindings(), titles);

    if (conflict) {
      const answer = await askChoice(
        t('keys.conflict.title'),
        conflictQuestion(conflict, labelOf(binding)),
        [
          { id: 'cancel', label: t('common.cancel'), cancel: true, primary: true },
          { id: 'take', label: t('keys.conflict.take'), danger: true },
        ],
      );
      if (answer !== 'take') return;
    }

    await apply(ipc.setBinding(id, binding));
  }

  async function unbind(id: string): Promise<void> {
    stopCapture();
    await apply(ipc.setBinding(id, null));
  }

  async function resetOne(id: string): Promise<void> {
    stopCapture();
    await apply(ipc.resetBinding(id));
  }

  async function resetAll(): Promise<void> {
    stopCapture();
    const answer = await askChoice(
      t('keys.reset-all.title'),
      t('keys.reset-all.text'),
      [
        { id: 'cancel', label: t('common.cancel'), cancel: true, primary: true },
        { id: 'reset', label: t('keys.reset'), danger: true },
      ],
    );
    if (answer !== 'reset') return;

    await apply(ipc.resetKeymap());
  }
</script>

<div class="head">
  <input
    class="control text"
    type="text"
    bind:value={filter}
    placeholder={t('keys.search')}
    aria-label={t('keys.search.label')}
    spellcheck="false"
  />
  <button class="button quiet" type="button" disabled={broken !== null} onclick={resetAll}>
    {t('keys.reset-all')}
  </button>
</div>

{#if broken}
  <p class="broken">
    <Icon name="status.warning" />
    {broken}
  </p>
{:else}
  <!-- Что не применилось — списком, но вкладка не запирается: остальные
       строки прочитаны и действуют (Р-248). До задачи 114 одна опечатка
       в keymap.toml отменяла все переназначения и запирала правку. -->
  {#if skipped.length > 0}
    <div class="broken problems">
      <Icon name="status.warning" />
      <div>
        <p class="lead">{t('keys.problems')}</p>
        <ul>
          {#each skipped as line (line)}
            <li>{line}</li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
  {#if problem}
    <p class="broken">
      <Icon name="status.warning" />
      {problem}
    </p>
  {/if}
{/if}

<p class="note lead">{t('keys.lead')}</p>

{#if shown.length === 0}
  <p class="note">{t('keys.empty')}</p>
{:else}
  <div class="rows">
    {#each shown as command (command.id)}
      <div class="row" data-capturing={capturing === command.id ? '' : undefined}>
        <!-- Тот же значок, что у команды в меню и в палитре: список клавиш —
             третье место, где человек ищет ту же команду глазами. -->
        <span class="glyph">
          {#if iconForCommand(command.id)}<Icon name={iconForCommand(command.id)!} />{/if}
        </span>
        <div class="what">
          <span class="name">{command.title}</span>
          <span class="note">{command.id}</span>
        </div>

        {#if capturing === command.id}
          <span class="asking">
            {#if refused}
              {t('keys.refused', { key: labelOf(refused) })}
            {:else}
              {t('keys.asking')}
            {/if}
          </span>
          <button class="button quiet" type="button" onclick={() => unbind(command.id)}>
            {t('keys.unbind')}
          </button>
        {:else}
          <span class="keys">
            {#if command.bindings.length === 0}
              <span class="note">{t('keys.none')}</span>
            {:else}
              {#each command.bindings as binding (binding)}
                <kbd class="key">{labelOf(binding)}</kbd>
              {/each}
            {/if}
          </span>
          <button
            class="button quiet"
            type="button"
            disabled={broken !== null}
            onclick={() => beginCapture(command.id)}
          >
            {t('keys.change')}
          </button>
          {#if changed(command)}
            <button
              class="button quiet"
              type="button"
              disabled={broken !== null}
              onclick={() => resetOne(command.id)}
            >
              {t('keys.reset')}
            </button>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
    margin-bottom: var(--zn-space-4);
  }

  .control {
    flex: 1;
    min-width: 0;
    height: var(--zn-control-field-height);
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

  .broken {
    display: flex;
    align-items: center;
    gap: var(--zn-space-2);
    margin: 0 0 var(--zn-space-4) 0;
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

  .rows {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
    padding-block: var(--zn-space-3);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  /* Значок занимает своё место всегда, даже пустой: строки списка не должны
     разъезжаться из-за команды, которой значок ещё не нарисовали. */
  .glyph {
    display: inline-flex;
    flex: none;
    width: var(--zn-control-icon-size);
    color: var(--zn-color-fg-subtle);
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

  .lead {
    margin: 0 0 var(--zn-space-4) 0;
  }

  .keys {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--zn-space-2);
  }

  .key {
    padding: var(--zn-space-1) var(--zn-space-2);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-sm);
    background-color: var(--zn-color-bg-canvas);
    color: var(--zn-color-fg-muted);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui-small);
  }

  /* Ожидание нажатия видно издалека: пока оно на экране, ни одна команда
     в приложении не работает, и человек должен понимать почему.
     Место делится с названием поровну и переносится: объяснение отказа
     (С7 ревизии) длинное, и в узкой области оно выталкивало «Снять»
     за край строки. */
  .asking {
    flex: 1;
    min-width: 0;
    text-align: end;
    color: var(--zn-color-accent);
    font-size: var(--zn-font-size-ui-small);
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

  /* Кнопок в строке две, и обе второстепенные: главное здесь — список. */
  .quiet {
    border-color: var(--zn-color-border-default);
    background-color: transparent;
    color: var(--zn-color-fg-default);
  }

  .quiet:hover:not(:disabled) {
    background-color: var(--zn-color-bg-hover);
  }

  .button:disabled {
    color: var(--zn-color-fg-subtle);
  }
</style>
