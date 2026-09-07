<script lang="ts">
  import Icon from './Icon.svelte';
  import Popup from './Popup.svelte';
  import type { PopupItem } from './popup-item';
  import { appearance } from '../theme/store.svelte';
  import {
    activeTab,
    languageOf,
    livePreviewOf,
    setIndent,
    setLanguage,
    wrapOf,
  } from '../state/tabs.svelte';
  import { LANGUAGES, languageForFile } from '../editor/langs';
  import { indexing, cancel as cancelIndexing } from '../state/index.svelte';
  import { wrapEnabled, toggleWrap, toggleLivePreview } from '../state/settings.svelte';
  import { plural } from './plural';
  import { positionOf, positionLabel } from './position';
  import { indentLabel, indentSource } from '../editor/indent';
  import { fileSize } from './size';
  import { scaleLabel, ZOOM_STEPS, type Scale } from './zoom';
  import { commandList } from '../keymap/global.svelte';
  import { labelOf } from '../keymap/binding';
  import { goToLineDialog, goToPageDialog } from '../actions/navigate';
  import type { EncodingId, LineEnding } from '../ipc/files';
  import { convertTo, reinterpretAs, setBom, setLineEnding } from '../actions/encoding';

  const look = $derived(appearance.current);
  const tab = $derived(activeTab());

  /**
   * Редактор активной вкладки. `null` — вкладка не текст (Р-180).
   *
   * Правая половина строки состояния — это свойства текста: позиция курсора,
   * перенос, превью, отступ, язык, переносы строк, кодировка. У вкладки
   * параметров нет ни одного из них, и «UTF-8 · CRLF» над ней было бы тихой
   * неправдой — той же породы, что «без переноса» над переносящимся текстом
   * (Р-156).
   */
  const ed = $derived(tab?.editor ?? null);

  /** Состояние показа картинки. `null` — вкладка не картинка. */
  const img = $derived(tab?.image ?? null);

  /** Состояние показа PDF. `null` — вкладка не PDF. */
  const doc = $derived(tab?.pdf ?? null);

  /**
   * То, что показывают, а не правят: картинка или PDF.
   *
   * У обоих один и тот же масштаб и один и тот же список ступеней —
   * и меню масштаба поэтому одно на двоих.
   */
  const viewed = $derived(img ?? doc);

  /**
   * Сколько курсоров в активной вкладке.
   *
   * Читается прямо из состояния редактора: оно и так обновляется на каждое
   * изменение выделения, второго источника заводить незачем. Показывается
   * только когда курсоров больше одного — иначе это шум в каждом кадре.
   */
  const cursors = $derived(ed?.state.selection.ranges.length ?? 1);

  /** Строка, столбец и размер выделения. Считается там же и по той же причине. */
  const position = $derived(ed ? positionOf(ed.state) : null);
  const lines = $derived(ed?.state.doc.lines ?? 0);

  /**
   * Сочетание берётся из раскладки, а не пишется в разметку: его могли
   * переназначить в keymap.toml, и подсказка обязана показывать то, что
   * и правда нажимается.
   */
  const goToLineKey = $derived(
    commandList().find((command) => command.id === 'view.go-to-line')?.binding ?? null,
  );

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

  type Menu = 'encoding' | 'eol' | 'language' | 'indent' | 'scale';

  let openMenu = $state<Menu | null>(null);
  let anchorRect = $state<DOMRect | null>(null);

  function toggle(menu: Menu, event: MouseEvent): void {
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

  /**
   * Отступ вкладки.
   *
   * Показывать определённое обязательно (Р-106): молчаливая догадка хуже
   * настройки. В подсказке — откуда оно взялось.
   */
  const WIDTHS = [2, 4, 8];

  const indentItems = $derived.by((): PopupItem[] => {
    if (!ed) return [];
    const current = ed.indent;

    return [
      {
        id: 'style:spaces',
        label: 'Пробелы',
        section: 'Набирать отступ',
        checked: current.style === 'spaces',
      },
      { id: 'style:tabs', label: 'Табы', checked: current.style === 'tabs' },
      ...WIDTHS.map((width, index) => ({
        id: `width:${width}`,
        label: String(width),
        section: index === 0 ? 'Ширина' : undefined,
        checked: current.width === width,
      })),
    ];
  });

  /**
   * Смена отступа меняет то, чем набирается новый, и только это. Уже набранное
   * в файле не трогается: это была бы правка всего файла без команды на неё —
   * прямо против инварианта 1.
   */
  function pickIndent(id: string): void {
    openMenu = null;
    if (!tab || !ed) return;

    const [what, value] = id.split(':');
    const current = ed.indent;

    if (what === 'style') {
      setIndent(tab.meta.id, { style: value as 'tabs' | 'spaces', width: current.width });
    } else {
      setIndent(tab.meta.id, { style: current.style, width: Number(value) });
    }
  }

  /**
   * Масштаб картинки.
   *
   * «Вписать» стоит первым и без числа: оно зависит от размера окна
   * и менялось бы при каждом перетаскивании края.
   */
  const scaleItems = $derived.by((): PopupItem[] => {
    if (!viewed) return [];

    return [
      {
        id: 'fit',
        label: doc ? 'По ширине окна' : 'Вписать в окно',
        section: 'Масштаб',
        checked: viewed.scale === 'fit',
        hint: doc
          ? 'Растянуть страницу на всю ширину области показа.'
          : 'Уменьшить до размеров окна. Маленькая картинка не растягивается.',
      },
      ...ZOOM_STEPS.map((step) => ({
        id: String(step),
        label: `${Math.round(step * 100)} %`,
        checked: viewed.scale === step,
      })),
    ];
  });

  function pickScale(id: string): void {
    openMenu = null;
    if (!viewed) return;
    viewed.scale = (id === 'fit' ? 'fit' : Number(id)) as Scale;
  }

  /** Язык, действующий сейчас, и признак «выбран вручную». */
  const language = $derived(tab ? languageOf(tab) : null);
  const autoLanguage = $derived(
    tab ? languageForFile(tab.meta.path ?? tab.meta.title) : null,
  );

  const languageItems = $derived.by((): PopupItem[] => {
    if (!tab || !ed) return [];

    return [
      {
        id: 'auto',
        label: autoLanguage ? `По имени файла (${autoLanguage.label})` : 'По имени файла',
        section: 'Подсветка',
        checked: ed.language === null,
        hint: 'Определять язык по расширению. Незнакомое — обычный текст.',
      },
      {
        id: 'none',
        label: 'Без подсветки',
        checked: ed.language === 'none',
      },
      ...LANGUAGES.map((lang, index) => ({
        id: lang.id,
        label: lang.label,
        section: index === 0 ? 'Выбрать язык' : undefined,
        checked: ed.language === lang.id,
      })),
    ];
  });

  function pickLanguage(id: string): void {
    openMenu = null;
    if (!tab) return;
    setLanguage(tab.meta.id, id === 'auto' ? null : id);
  }
</script>

<footer class="statusbar">
  {#if look}
    <span class="item" title={look.dataDir}>
      <Icon name={look.portable ? 'status.folder' : 'status.folder-alert'} />
      {look.portable ? 'данные рядом с приложением' : 'данные в запасной папке'}
    </span>
  {/if}

  {#if indexing.progress.running}
    <span class="item" title="Идёт индексация проекта. Поиск уже работает, но находит не всё.">
      {#if indexing.progress.total > 0}
        индексация: {indexing.progress.done} из {indexing.progress.total}
      {:else}
        индексация: обход папок
      {/if}
    </span>
    <button
      class="item action"
      type="button"
      onclick={cancelIndexing}
      title="Остановить индексацию"
      aria-label="Остановить индексацию"
    >
      <Icon name="action.remove" />
    </button>
  {/if}

  <span class="spacer"></span>

  {#if position}
    <button
      class="item action"
      type="button"
      onclick={() => void goToLineDialog()}
      title="Строка {position.line} из {lines}, столбец {position.column}. Нажмите, чтобы перейти к строке{goToLineKey
        ? ` (${labelOf(goToLineKey)})`
        : ''}."
    >
      {positionLabel(position)}
    </button>
  {/if}

  {#if cursors > 1}
    <span class="item accent" title="Escape — вернуться к одному курсору">
      {cursors} {plural(cursors, 'курсор', 'курсора', 'курсоров')}
    </span>
  {/if}

  <!--
    У картинки свои свойства и свои же три места в строке: настоящий размер,
    вес файла и масштаб показа. Кодировки и переносов у неё нет (Р-180).
  -->
  {#if tab && img}
    {#if img.width > 0}
      <span class="item" title="Настоящий размер картинки в точках">
        {img.width} × {img.height}
      </span>
    {/if}

    {#if tab.meta.disk}
      <span class="item" title="Вес файла на диске">{fileSize(tab.meta.disk.size)}</span>
    {/if}

    <button
      class="item action"
      type="button"
      title="Масштаб показа. Щелчок по картинке переключает «по окну» и настоящий размер, Ctrl с колесом меняет ступенями."
      onclick={(e) => toggle('scale', e)}
    >
      {scaleLabel(img.scale)}
    </button>
  {/if}

  <!--
    У PDF свои три места: страница, вес файла и масштаб. Поиска среди них нет,
    и это решение владельца (Р-181): ZeroNote документ показывает, но не читает.
  -->
  {#if tab && doc}
    <button
      class="item action"
      type="button"
      title="Перейти к странице{goToLineKey ? ` (${labelOf(goToLineKey)})` : ''}"
      onclick={() => void goToPageDialog(doc)}
    >
      {doc.pages > 0 ? `стр ${doc.page} из ${doc.pages}` : 'открываю…'}
    </button>

    {#if tab.meta.disk}
      <span class="item" title="Вес файла на диске">{fileSize(tab.meta.disk.size)}</span>
    {/if}

    <button
      class="item action"
      type="button"
      title="Масштаб показа"
      onclick={(e) => toggle('scale', e)}
    >
      {scaleLabel(doc.scale, 'по ширине')}
    </button>
  {/if}

  <!--
    Всё, что ниже, — свойства текста, и показывается оно только над текстом.
    У вкладки параметров ни кодировки, ни переносов, ни отступа нет: строка
    состояния зависит от вида вкладки (Р-180).
  -->
  {#if tab && ed}
    <!--
      Показывается перенос **этой вкладки**, а не общая настройка: у markdown
      его включает читаемая ширина (Р-156), и надпись «без переноса» над
      переносящимся текстом была бы тихой неправдой. Нажатие по-прежнему
      меняет общую настройку — подпись подсказки об этом и говорит.
    -->
    <button
      class="item action"
      type="button"
      title={wrapOf(tab) && !wrapEnabled()
        ? 'Перенос включён читаемой шириной markdown. Нажатие меняет общую настройку для остальных файлов'
        : wrapEnabled()
          ? 'Длинные строки переносятся по ширине окна — нажмите, чтобы выключить'
          : 'Длинные строки не переносятся — нажмите, чтобы включить'}
      onclick={() => void toggleWrap()}
    >
      {wrapOf(tab) ? 'перенос' : 'без переноса'}
    </button>

    <!--
      Переключатель превью стоит только над markdown: в коде и обычном тексте
      прятать нечего, и кнопка «исходник» там означала бы, что бывает и другое
      состояние. Порядок тот же, что у переноса: показывается состояние этой
      вкладки, нажатие меняет общую настройку.
    -->
    {#if languageOf(tab)?.id === 'markdown'}
      <button
        class="item action"
        type="button"
        title={livePreviewOf(tab)
          ? 'Знаки разметки не показываются; строка под курсором — всегда исходник. Нажмите, чтобы показать разметку'
          : 'Показывается исходник со знаками разметки — нажмите, чтобы включить живое превью'}
        onclick={() => void toggleLivePreview()}
      >
        {livePreviewOf(tab) ? 'превью' : 'исходник'}
      </button>
    {/if}

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
      type="button"
      title="{indentSource(ed.indent)}. Смена меняет только то, чем набирается новый отступ; уже набранное в файле остаётся как есть."
      onclick={(e) => toggle('indent', e)}
    >
      {indentLabel(ed.indent)}
    </button>

    <button
      class="item action"
      type="button"
      title={ed.language === null
        ? 'Язык подсветки определён по имени файла — нажмите, чтобы сменить'
        : 'Язык подсветки выбран вручную — нажмите, чтобы сменить'}
      onclick={(e) => toggle('language', e)}
    >
      {language ? language.label : 'обычный текст'}
    </button>

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

{#if openMenu === 'language' && anchorRect}
  <Popup
    items={languageItems}
    anchor={anchorRect}
    onpick={pickLanguage}
    onclose={() => (openMenu = null)}
  />
{/if}

{#if openMenu === 'indent' && anchorRect}
  <Popup
    items={indentItems}
    anchor={anchorRect}
    onpick={pickIndent}
    onclose={() => (openMenu = null)}
  />
{/if}

{#if openMenu === 'scale' && anchorRect}
  <Popup
    items={scaleItems}
    anchor={anchorRect}
    onpick={pickScale}
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

  /* Технические значения — моноширинным, как в референсе: UTF-8, CRLF и имя
     языка читаются как значения, а не как фраза. Русские пояснения слева
     остаются шрифтом интерфейса — моноширинная кириллица в них расползается
     и начинает спорить с текстом в редакторе. */
  .action {
    padding-inline: var(--zn-space-2);
    border: none;
    border-radius: var(--zn-radius-sm);
    background-color: transparent;
    color: inherit;
    font-family: var(--zn-font-family-editor);
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

  /* Мультикурсор — состояние необычное и временное, его видно акцентом. */
  .accent {
    color: var(--zn-color-accent);
  }

  /* Кодировка, угаданная эвристикой, показывается тише уверенной:
     это подсказка «проверь глазами», а не утверждение. */
  .uncertain {
    color: var(--zn-color-fg-subtle);
    font-style: italic;
  }
</style>
