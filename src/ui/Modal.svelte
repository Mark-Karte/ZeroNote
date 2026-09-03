<script lang="ts">
  import { modal } from '../state/modal.svelte';

  const request = $derived(modal.request);
  let primaryButton = $state<HTMLButtonElement | null>(null);
  let field = $state<HTMLInputElement | null>(null);
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
    const fallback = request?.choices.find((c) => c.cancel);
    pick(fallback ? fallback.id : null);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!request) return;

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
  $effect(() => {
    if (!request) return;
    if (field) {
      field.focus();
      field.select();
    } else if (primaryButton) {
      primaryButton.focus();
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

{#if request}
  <div class="layer">
    <!-- Затемнение отдельным слоем, чтобы прозрачность не досталась
         содержимому диалога. -->
    <button class="backdrop" type="button" aria-label="Закрыть" onclick={cancel}
    ></button>

    <div class="dialog" role="dialog" aria-modal="true" aria-label={request.title}>
      <h2 class="title">{request.title}</h2>
      <p class="text">{request.text}</p>
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
    min-width: min(var(--zn-control-dialog-min-width), 90vw);
    max-width: min(var(--zn-control-dialog-max-width), 92vw);
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
    color: var(--zn-color-fg-muted);
    white-space: pre-line;
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
