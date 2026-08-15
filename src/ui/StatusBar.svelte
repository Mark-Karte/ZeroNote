<script lang="ts">
  import Icon from './Icon.svelte';
  import { appearance } from '../theme/store.svelte';
  import { activeTab } from '../state/tabs.svelte';

  // TODO(задача 4, часть 2): кодировка и переносы станут кнопками — «интерпретировать
  // как» и «преобразовать в» уже есть в ядре, нужен выпадающий список.
  // TODO(задача 7): позиция курсора и выделение.
  // TODO(окно параметров): состав строки состояния должен настраиваться.
  const look = $derived(appearance.current);
  const tab = $derived(activeTab());

  const EOL_LABEL: Record<string, string> = {
    lf: 'LF',
    'cr-lf': 'CRLF',
    cr: 'CR',
  };

  const ENCODING_LABEL: Record<string, string> = {
    utf8: 'UTF-8',
    'utf16-le': 'UTF-16 LE',
    'utf16-be': 'UTF-16 BE',
    windows1251: 'windows-1251',
    windows1252: 'windows-1252',
    ibm866: 'IBM866',
    'koi8-r': 'KOI8-R',
  };
</script>

<footer class="statusbar">
  {#if look}
    <span class="item" title={look.dataDir}>
      <Icon name={look.portable ? 'status.folder' : 'status.folder-alert'} />
      {look.portable ? 'данные рядом с приложением' : 'данные в запасной папке'}
    </span>
  {/if}

  <span class="spacer"></span>

  {#if tab}
    {#if tab.meta.readOnly}
      <span class="item warn" title="Правка запрещена">
        {tab.meta.large ? 'большой файл, только чтение' : 'только чтение'}
      </span>
    {/if}

    {#if tab.meta.lossy}
      <span class="item warn" title="При чтении встретились байты, недопустимые в этой кодировке. Сохранение изменит файл.">
        <Icon name="status.warning" />
        потери при чтении
      </span>
    {/if}

    <span
      class="item"
      class:warn={tab.meta.eolMixed}
      title={tab.meta.eolMixed
        ? 'В файле разные типы переносов. При сохранении будет предложено привести к одному.'
        : 'Тип переноса строк'}
    >
      {EOL_LABEL[tab.meta.eol] ?? tab.meta.eol}{tab.meta.eolMixed ? ' (смешанные)' : ''}
    </span>

    <span
      class="item"
      class:uncertain={!tab.meta.encodingConfident}
      title={tab.meta.encodingConfident
        ? 'Кодировка файла'
        : 'Кодировка определена эвристикой и может быть неверной'}
    >
      {ENCODING_LABEL[tab.meta.encoding] ?? tab.meta.encoding}{tab.meta.bom ? ' + BOM' : ''}
    </span>
  {/if}

  {#if look}
    {#if look.problems.length > 0}
      <span class="item warn" title={look.problems.join('\n')}>
        <Icon name="status.warning" />
        {look.problems.length}
      </span>
    {/if}

    <span class="item">
      <Icon
        name={look.appearance === 'dark' ? 'status.theme-dark' : 'status.theme-light'}
      />
      {look.themeName}
    </span>
  {/if}
</footer>

<style>
  .statusbar {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--zn-space-4);
    height: var(--zn-control-statusbar-height);
    padding-inline: var(--zn-space-4);
    background-color: var(--zn-color-bg-surface);
    border-top: var(--zn-border-width) solid var(--zn-color-border-subtle);
    color: var(--zn-color-fg-muted);
    font-size: var(--zn-font-size-ui-small);
    line-height: var(--zn-font-line-height-ui);
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: var(--zn-space-2);
    white-space: nowrap;
  }

  .spacer {
    flex: 1;
  }

  .warn {
    color: var(--zn-color-warning);
  }

  /* Кодировка, угаданная эвристикой, показывается тише уверенной:
     это подсказка «проверь глазами», а не утверждение. */
  .uncertain {
    color: var(--zn-color-fg-subtle);
    font-style: italic;
  }
</style>
