<script lang="ts">
  import Icon from './Icon.svelte';
  import Popup from './Popup.svelte';
  import type { PopupItem } from './popup-item';
  import { appearance } from '../theme/store.svelte';
  import { activeTab } from '../state/tabs.svelte';
  import type { EncodingId, LineEnding } from '../ipc/files';
  import { convertTo, reinterpretAs, setBom, setLineEnding } from '../actions/encoding';

  // TODO(задача 7): позиция курсора, номер строки, размер выделения.
  // TODO(окно параметров): состав строки состояния должен настраиваться.
  const look = $derived(appearance.current);
  const tab = $derived(activeTab());

  const EOL_LABEL: Record<LineEnding, string> = {
    lf: 'LF',
    'cr-lf': 'CRLF',
    cr: 'CR',
  };

  const EOL_FULL: Record<LineEnding, string> = {
    'cr-lf': 'CRLF — Windows',
    lf: 'LF — Unix',
    cr: 'CR — классический Mac',
  };

  const ENCODINGS: { id: EncodingId; label: string; bom: boolean }[] = [
    { id: 'utf8', label: 'UTF-8', bom: true },
    { id: 'utf16-le', label: 'UTF-16 LE', bom: true },
    { id: 'utf16-be', label: 'UTF-16 BE', bom: true },
    { id: 'windows1251', label: 'windows-1251', bom: false },
    { id: 'windows1252', label: 'windows-1252', bom: false },
    { id: 'ibm866', label: 'IBM866', bom: false },
    { id: 'koi8-r', label: 'KOI8-R', bom: false },
  ];

  const ENCODING_LABEL = Object.fromEntries(ENCODINGS.map((e) => [e.id, e.label]));

  let openMenu = $state<'encoding' | 'eol' | null>(null);
  let anchorRect = $state<DOMRect | null>(null);

  function toggle(menu: 'encoding' | 'eol', event: MouseEvent): void {
    if (openMenu === menu) {
      openMenu = null;
      return;
    }
    anchorRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu = menu;
  }

  const encodingItems = $derived.by((): PopupItem[] => {
    if (!tab) return [];
    const current = tab.meta.encoding;
    const hasFile = tab.meta.path !== null;
    const supportsBom = ENCODINGS.find((e) => e.id === current)?.bom ?? false;

    return [
      ...ENCODINGS.map((e, index) => ({
        id: `reinterpret:${e.id}`,
        label: e.label,
        section: index === 0 ? 'Интерпретировать как' : undefined,
        checked: e.id === current,
        disabled: !hasFile,
        hint: hasFile
          ? 'Перечитать те же байты этой кодировкой. Лечит крякозябры, файл не меняется.'
          : 'Буфер не привязан к файлу: перечитывать нечего.',
      })),
      ...ENCODINGS.map((e, index) => ({
        id: `convert:${e.id}`,
        label: e.label,
        section: index === 0 ? 'Преобразовать в' : undefined,
        checked: e.id === current,
        hint: 'Оставить текст, сменить кодировку записи. Файл изменится при сохранении.',
      })),
      {
        id: 'bom',
        label: 'Метка порядка байтов (BOM)',
        section: 'Запись',
        checked: tab.meta.bom,
        disabled: !supportsBom,
        hint: supportsBom
          ? 'Добавить или убрать метку в начале файла.'
          : 'У этой кодировки метки не бывает.',
      },
    ];
  });

  const eolItems = $derived.by((): PopupItem[] => {
    if (!tab) return [];
    return (['cr-lf', 'lf', 'cr'] as LineEnding[]).map((eol) => ({
      id: eol,
      label: EOL_FULL[eol],
      checked: eol === tab.meta.eol,
    }));
  });

  async function pickEncoding(id: string): Promise<void> {
    openMenu = null;
    if (!tab) return;

    if (id === 'bom') {
      await setBom(tab.meta.id, !tab.meta.bom);
      return;
    }

    const [action, encoding] = id.split(':') as ['reinterpret' | 'convert', EncodingId];
    if (action === 'reinterpret') {
      await reinterpretAs(tab.meta.id, encoding);
    } else {
      await convertTo(tab.meta.id, encoding);
    }
  }

  async function pickEol(id: string): Promise<void> {
    openMenu = null;
    if (tab) await setLineEnding(tab.meta.id, id as LineEnding);
  }
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
      <span
        class="item warn"
        title="При чтении встретились байты, недопустимые в этой кодировке. Сохранение изменит файл."
      >
        <Icon name="status.warning" />
        потери при чтении
      </span>
    {/if}

    <button
      class="item action"
      class:warn={tab.meta.eolMixed}
      type="button"
      title={tab.meta.eolMixed
        ? 'В файле разные типы переносов. При сохранении будет предложено привести к одному.'
        : 'Тип переноса строк — нажмите, чтобы сменить'}
      onclick={(e) => toggle('eol', e)}
    >
      {EOL_LABEL[tab.meta.eol]}{tab.meta.eolMixed ? ' (смешанные)' : ''}
    </button>

    <button
      class="item action"
      class:uncertain={!tab.meta.encodingConfident}
      type="button"
      title={tab.meta.encodingConfident
        ? 'Кодировка файла — нажмите, чтобы сменить'
        : 'Кодировка определена эвристикой и может быть неверной. Нажмите, чтобы сменить.'}
      onclick={(e) => toggle('encoding', e)}
    >
      {ENCODING_LABEL[tab.meta.encoding] ?? tab.meta.encoding}{tab.meta.bom ? ' + BOM' : ''}
    </button>
  {/if}

  {#if look}
    {#if look.problems.length > 0}
      <span class="item warn" title={look.problems.join('\n')}>
        <Icon name="status.warning" />
        {look.problems.length}
      </span>
    {/if}

    <span class="item">
      <Icon name={look.appearance === 'dark' ? 'status.theme-dark' : 'status.theme-light'} />
      {look.themeName}
    </span>
  {/if}
</footer>

{#if openMenu === 'encoding' && anchorRect}
  <Popup
    items={encodingItems}
    anchor={anchorRect}
    onpick={pickEncoding}
    onclose={() => (openMenu = null)}
  />
{/if}

{#if openMenu === 'eol' && anchorRect}
  <Popup
    items={eolItems}
    anchor={anchorRect}
    onpick={pickEol}
    onclose={() => (openMenu = null)}
  />
{/if}

<style>
  .statusbar {
    display: flex;
    flex: none;
    align-items: stretch;
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

  .action {
    padding-inline: var(--zn-space-2);
    border: none;
    background-color: transparent;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    cursor: default;
  }

  .action:hover {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
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
