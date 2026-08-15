<script lang="ts">
  import Icon from './Icon.svelte';
  import { appearance } from '../theme/store.svelte';

  interface Props {
    /** Сообщения не про оформление: что не удалось восстановить из сессии. */
    extra?: string[];
  }

  let { extra = [] }: Props = $props();

  // Проблемы с настройками, темами и сессией показываются, а не прячутся в лог:
  // пользователь правит эти файлы руками и должен видеть, что пошло не так.
  const problems = $derived([...(appearance.current?.problems ?? []), ...extra]);
</script>

{#if problems.length > 0}
  <aside class="strip">
    <Icon name="status.warning" />
    <ul class="list">
      {#each problems as problem (problem)}
        <li>{problem}</li>
      {/each}
    </ul>
  </aside>
{/if}

<style>
  .strip {
    display: flex;
    align-items: flex-start;
    gap: var(--zn-space-3);
    padding: var(--zn-space-3) var(--zn-space-4);
    background-color: var(--zn-color-bg-surface);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-default);
    color: var(--zn-color-warning);
    font-size: var(--zn-font-size-ui-small);
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--zn-space-1);
    /* Длинный путь к файлу не должен растягивать окно. */
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
