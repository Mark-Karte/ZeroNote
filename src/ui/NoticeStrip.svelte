<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '../l10n';
  import { appearance } from '../theme/store.svelte';

  interface Props {
    /** Сообщения не про оформление: что не удалось восстановить из сессии. */
    extra?: string[];
  }

  let { extra = [] }: Props = $props();

  /**
   * Полоса предупреждений (Р-032): ошибки едут пользователю, а не в лог.
   *
   * Пользователь правит `settings.toml`, `keymap.toml` и файлы тем руками,
   * и молчаливое «настройка не применилась» отлаживать нечем.
   */
  const problems = $derived([...(appearance.current?.problems ?? []), ...extra]);

  /**
   * Что уже прочитали и скрыли.
   *
   * Хранится не признак «скрыто», а сам набор сообщений: скрыв жалобу
   * на сломанный `settings.toml`, пользователь не должен пропустить новую.
   * Изменился набор — полоса возвращается.
   */
  let dismissed = $state('');

  // Набор сообщений строкой: JSON однозначен при любых знаках внутри
  // сообщений. До этого здесь стоял разделитель NUL, записанный самим
  // знаком, — и git считал файл двоичным.
  const key = $derived(JSON.stringify(problems));
  const shown = $derived(problems.length > 0 && key !== dismissed);
</script>

{#if shown}
  <aside class="strip">
    <span class="sign"><Icon name="status.warning" /></span>

    <ul class="list">
      {#each problems as problem (problem)}
        <li>{problem}</li>
      {/each}
    </ul>

    <!-- Скрыть, а не «исправлено»: причина остаётся, и при следующем запуске
         или при новой жалобе полоса появится снова. -->
    <button
      class="hide"
      type="button"
      onclick={() => (dismissed = key)}
      title={t('notices.hide')}
      aria-label={t('notices.hide.label')}
    >
      <Icon name="action.remove" />
    </button>
  </aside>
{/if}

<style>
  .strip {
    display: flex;
    flex: none;
    align-items: flex-start;
    gap: var(--zn-space-3);
    margin: var(--zn-space-1) var(--zn-space-1) 0;
    padding: var(--zn-space-3);
    /* Полоса — такая же панель, как дерево и редактор, но с рамкой цвета
       предупреждения: в новом языке отличие показывается тоном и рамкой,
       а не заливкой во всю ширину. */
    background-color: var(--zn-color-bg-surface);
    border: var(--zn-border-width) solid var(--zn-color-warning);
    border-radius: var(--zn-radius-lg);
    color: var(--zn-color-warning);
    font-size: var(--zn-font-size-ui-small);
  }

  .sign {
    display: inline-flex;
    flex: none;
    /* Значок выравнивается по первой строке текста, а не по центру полосы:
       сообщений бывает несколько, и посередине он оказывался бы напротив
       пустого места. */
    margin-top: calc((var(--zn-font-size-ui-small) - var(--zn-control-icon-size)) / 2);
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--zn-space-1);
    /* Длинный путь к файлу не должен растягивать окно. */
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .hide {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    padding: var(--zn-space-1);
    border: none;
    border-radius: var(--zn-radius-sm);
    background-color: transparent;
    color: inherit;
    cursor: default;
    opacity: 0.7;
  }

  .hide:hover {
    background-color: var(--zn-color-bg-hover);
    opacity: 1;
  }
</style>
