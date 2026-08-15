<script lang="ts">
  import { icon, type IconName } from '../icons/registry';

  let { name }: { name: IconName } = $props();
</script>

<!-- Разметка берётся из собственного реестра, а не из пользовательских данных,
     поэтому {@html} здесь безопасен. -->
<span class="icon" aria-hidden="true">{@html icon(name)}</span>

<style>
  .icon {
    display: inline-flex;
    flex: none;
    width: var(--zn-control-icon-size);
    height: var(--zn-control-icon-size);
  }

  .icon :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
