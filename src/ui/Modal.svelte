<script lang="ts">
  import Icon from './Icon.svelte';
  import { modal } from '../state/modal.svelte';

  const request = $derived(modal.request);
  // Вопрос, пришедший посреди работы, встаёт поверх хода работы, а ответ
  // на него возвращает ход на место (задача 104).
  const progress = $derived(modal.request ? null : modal.progress);
  const shown = $derived(request ?? progress);
  let primaryButton = $state<HTMLButtonElement | null>(null);
  let field = $state<HTMLInputElement | null>(null);
  let dialog = $state<HTMLDivElement | null>(null);
  let value = $state('');

  function pick(id: string | null): void {
    // У диалога с полем ввода ответом служит введённое, а не имя кнопки:
    // вызывающему коду нужна строка, а не «нажали ОК».
    if (request?.input && id !== null && id !== 'cancel') {
      request.resolve(value);
      return;
    }
    request?.resolve(id === 'cancel' ? null : id);
  }

  function cancel(): void {
    // Ход работы закрывает тот, кто её ведёт: прервать её отсюда нельзя,
    // а закрытое окно при идущей работе выглядело бы как отмена.
    if (!request) return;

    const fallback = request.choices.find((c) => c.cancel);
    pick(fallback ? fallback.id : null);
  }

  function onKeyDown(event: KeyboardEvent): void {
    // У хода работы Escape — это «Отмена», как у кнопки; нет кнопки —
    // нет и отмены.
    if (!request) {
      if (event.key === 'Escape' && progress?.cancel) {
        event.preventDefault();
        event.stopPropagation();
        progress.cancel();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }

    if (event.key === 'Enter') {
      const primary = request.choices.find((c) => c.primary);
      if (primary) {
        event.preventDefault();
        event.stopPropagation();
        pick(primary.id);
      }
    }
  }

  // Фокус уводится в диалог: иначе клавиатура продолжает работать с редактором
  // под ним, а Enter и Escape до диалога не доходят. При наличии поля ввода
  // фокус достаётся ему — печатать сразу удобнее, чем сначала целиться мышью.
  //
  // У хода работы кнопок нет, и фокус получает сам диалог: иначе нажатые
  // буквы уходили бы в текст под ним.
  $effect(() => {
    if (!shown) return;
    if (field) {
      field.focus();
      field.select();
    } else if (primaryButton) {
      primaryButton.focus();
    } else if (dialog) {
      dialog.focus();
    }
  });

  // Начальное значение ставится один раз на каждый новый вопрос.
  $effect(() => {
    value = request?.input?.initial ?? '';
  });
</script>

<!-- Перехват, а не всплытие: оконная раскладка тоже стоит на перехвате,
     и без этого Escape ушёл бы ей, а не диалогу. -->
<svelte:window onkeydowncapture={onKeyDown} />

{#if shown}
  <div class="layer">
    <!-- Затемнение отдельным слоем, чтобы прозрачность не досталась
         содержимому диалога. -->
    <button class="backdrop" type="button" aria-label="Закрыть" onclick={cancel}
    ></button>

    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label={shown.title}
      tabindex="-1"
      bind:this={dialog}
    >
      <h2 class="title">{shown.title}</h2>
      <p class="text">{shown.text}</p>
      {#if request}
        {#if request.input}
          <input class="field" type="text" bind:this={field} bind:value />
        {/if}
        <div class="buttons">
          {#each request.choices as choice (choice.id)}
            {#if choice.primary}
              <button
                class="button primary"
                class:danger={choice.danger}
                type="button"
                bind:this={primaryButton}
                onclick={() => pick(choice.id)}
              >
                {choice.label}
              </button>
            {:else}
              <button
                class="button"
                class:danger={choice.danger}
                type="button"
                onclick={() => pick(choice.id)}
              >
                {choice.label}
              </button>
            {/if}
          {/each}
        </div>
      {:else if progress}
        <div class="progress" aria-live="polite">
          {#if progress.steps.length > 0}
            <ol class="steps">
              {#each progress.steps as step, index (index)}
                <li
                  class="step"
                  class:done={index < progress.step}
                  class:current={index === progress.step}
                >
                  <span class="mark">
                    {#if index < progress.step}
                      <Icon name="action.check" />
                    {/if}
                  </span>
                  {step}
                </li>
              {/each}
            </ol>
          {/if}
          <!-- Без длины полоски нет вовсе: пустая дорожка честнее бегунка,
               который изображает ход, не зная его. -->
          {#if progress.fraction !== null}
            <div class="track">
              <div class="fill" style:--done={progress.fraction}></div>
            </div>
          {/if}
          <p class="detail">{progress.detail}</p>
          {#if progress.warning}
            <p class="warning">{progress.warning}</p>
          {/if}
        </div>
        <!-- Фокус не на кнопке, а на диалоге: Enter по привычке не должен
             снимать загрузку, которую ждали. -->
        {#if progress.cancel}
          <div class="buttons">
            <button class="button" type="button" onclick={progress.cancel}>Отмена</button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .layer {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--zn-z-dialog);
  }

  .backdrop {
    position: absolute;
    inset: 0;
    padding: 0;
    border: none;
    /* Подложка задана цветом с прозрачностью, а не непрозрачным цветом
       и `opacity`: последнее гасило бы и сам диалог, если бы он оказался
       внутри, а заодно требовало бы подбирать прозрачность под каждую тему.
       Теперь это роль, и «Контраст» делает её плотнее прочих. */
    background-color: var(--zn-color-bg-overlay);
    cursor: default;
    animation: fade var(--zn-motion-duration-fast) var(--zn-motion-easing);
  }

  .dialog {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: min(var(--zn-control-dialog-min-width), 90vw);
    max-width: min(var(--zn-control-dialog-max-width), 92vw);
    /* Выше экрана диалог не растёт: длинный список уводил заголовок и кнопки
       за края окна, и подтвердить действие было нечем. Найдено приёмкой
       этапа 13 на замене в пяти тысячах файлов — до неё длинными списками
       были ссылки при переименовании, то есть десятки строк. */
    max-height: 88vh;
    padding: var(--zn-space-5);
    background-color: var(--zn-color-bg-raised);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-window);
    box-shadow: var(--zn-shadow-dialog);
    /* Диалог не возникает, а приподнимается. Это единственная анимация,
       которую первый круг разрешает: она короче, чем время реакции,
       и объясняет, откуда взялось окно, а не развлекает. */
    animation: rise var(--zn-motion-duration-normal) var(--zn-motion-easing);
  }

  /* Фокус у диалога только ради клавиатуры (ход работы без кнопок), рамка
     вокруг всего окна ничего не сообщает. */
  .dialog:focus {
    outline: none;
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      /* Смещение из токена отступов: пиксели здесь были бы зашитой величиной. */
      transform: translateY(calc(-1 * var(--zn-space-3)));
    }
  }

  .title {
    margin: 0 0 var(--zn-space-3) 0;
    color: var(--zn-color-fg-default);
    font-size: var(--zn-font-size-ui);
    font-weight: var(--zn-font-weight-strong);
  }

  .text {
    margin: 0 0 var(--zn-space-4) 0;
    /* Прокручивается текст, а не диалог: заголовок и кнопки остаются
       на месте, как бы длинен ни был список. `min-height` — чтобы flex
       разрешил сжать этот блок, иначе он растянул бы диалог по содержимому
       и предел высоты не сработал бы вовсе. */
    overflow-y: auto;
    min-height: 0;
    color: var(--zn-color-fg-muted);
    white-space: pre-line;
  }

  .progress {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-3);
  }

  .progress + .buttons {
    margin-top: var(--zn-space-4);
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* Будущий шаг приглушён, текущий — обычным текстом и весом, пройденный —
     обычным текстом с галочкой. Так видно и где мы, и что ещё впереди:
     «устанавливаю» после «скачиваю» и есть ответ на «сколько ещё ждать». */
  .step {
    display: flex;
    align-items: center;
    gap: var(--zn-space-3);
    color: var(--zn-color-fg-subtle);
  }

  .step.done {
    color: var(--zn-color-fg-default);
  }

  .step.current {
    color: var(--zn-color-fg-default);
    font-weight: var(--zn-font-weight-strong);
  }

  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--zn-control-icon-size);
    height: var(--zn-control-icon-size);
    color: var(--zn-color-success);
  }

  .track {
    height: var(--zn-control-progress-height);
    overflow: hidden;
    border-radius: var(--zn-radius-sm);
    background-color: var(--zn-color-bg-canvas);
  }

  /* Ширина — масштабом, а не свойством `width`: сотни кусков за загрузку
     не пересчитывают раскладку диалога. Доля приходит свойством `--done`. */
  .fill {
    height: 100%;
    background-color: var(--zn-color-accent);
    transform: scaleX(var(--done));
    transform-origin: left;
  }

  .detail {
    margin: 0;
    color: var(--zn-color-fg-muted);
    font-variant-numeric: tabular-nums;
  }

  .warning {
    margin: 0;
    color: var(--zn-color-warning);
  }

  .field {
    width: 100%;
    margin-bottom: var(--zn-space-5);
    padding: var(--zn-space-2) var(--zn-space-3);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-bg-canvas);
    color: var(--zn-color-fg-default);
    font-family: var(--zn-font-family-editor);
    font-size: var(--zn-font-size-ui);
  }

  .field:focus {
    outline: none;
    border-color: var(--zn-color-border-focus);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--zn-space-3);
  }

  .button {
    padding: var(--zn-space-2) var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-md);
    background-color: var(--zn-color-bg-surface);
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    cursor: default;
  }

  .button:hover {
    background-color: var(--zn-color-bg-hover);
  }

  /* Необратимый вариант виден цветом, а не только текстом: «не сохранять»
     и «сохранить» рядом различаются одним словом, и промах стоит данных. */
  .button.danger {
    border-color: var(--zn-color-danger);
    color: var(--zn-color-danger);
  }

  .button.danger:hover {
    background-color: var(--zn-color-danger);
    color: var(--zn-color-fg-on-accent);
  }

  .button.primary {
    background-color: var(--zn-color-accent);
    border-color: var(--zn-color-accent);
    color: var(--zn-color-fg-on-accent);
  }

  .button.primary:hover {
    background-color: var(--zn-color-accent-hover);
    border-color: var(--zn-color-accent-hover);
  }
</style>
