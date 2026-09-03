<script lang="ts">
  import { icon, type IconName } from '../icons/registry';

  let { name }: { name: IconName } = $props();
</script>

<!-- Разметка берётся из собственного реестра, а не из пользовательских данных,
     поэтому {@html} здесь безопасен. -->
<span class="icon" aria-hidden="true">{@html icon(name)}</span>

<style>
  /*
    Размер значок не назначает — он его наследует (Р-096, Р-100), ровно как
    наследует цвет через currentColor. Умолчание здесь — строка списка;
    контекст с другой ролью переопределяет --zn-control-icon-size у себя:

      .button { --zn-control-icon-size: var(--zn-control-icon-size-window); }

    Поэтому у значка нет свойства «размер», и новый значок, положенный
    в кнопку окна или в боковую полосу, оказывается нужного размера сам.
  */
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
