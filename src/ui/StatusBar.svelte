<script lang="ts">
  import Icon from './Icon.svelte';
  import Popup from './Popup.svelte';
  import type { PopupItem } from './popup-item';
  import { appearance } from '../theme/store.svelte';
  import {
    activeTab,
    visibleState,
    languageOf,
    livePreviewOf,
    setIndent,
    setLanguage,
    wrapOf,
  } from '../state/tabs.svelte';
  import { LANGUAGES, languageForFile } from '../editor/langs';
  import { indexing, cancel as cancelIndexing } from '../state/index.svelte';
  import { wrapEnabled, toggleWrap, toggleLivePreview } from '../state/settings.svelte';
  import { formatNumber, t, tn } from '../l10n';
  import { positionOf, positionLabel } from './position';
  import { indentLabel, indentSource } from '../editor/indent';
  import { fileSize } from './size';
  import { scaleLabel, ZOOM_STEPS, type Scale } from './zoom';
  import { commandList } from '../keymap/global.svelte';
  import { labelOf } from '../keymap/binding';
  import { goToLineDialog, goToPageDialog } from '../actions/navigate';
  import type { EncodingId, LineEnding } from '../ipc/files';
  import { convertTo, reinterpretAs, setBom, setLineEnding } from '../actions/encoding';
  import { countAll, countSelection, type Counts } from '../editor/word-count';
  import type { Text } from '@codemirror/state';
  import { untrack } from 'svelte';

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
  /**
   * Состояние, которое видно в активной области: у зеркала (Р-209) курсор
   * свой, и главное здесь показало бы чужую строку и столбец.
   */
  const shown = $derived(tab ? visibleState(tab) : null);
  const cursors = $derived(shown?.selection.ranges.length ?? 1);

  /** Строка, столбец и размер выделения. Считается там же и по той же причине. */
  const position = $derived(shown ? positionOf(shown) : null);
  const lines = $derived(shown?.doc.lines ?? 0);

  /**
   * Счётчик слов (задача 149): у заметки и у простого текста — в коде
   * слова не считают, как и Obsidian. Правила подсчёта — `editor/word-count.ts`.
   */
  const countable = $derived.by(() => {
    if (!tab || !ed || tab.meta.large) return false;
    const language = languageOf(tab);
    return language === null || language.id === 'markdown';
  });

  /**
   * Сколько знаков считается само, после паузы в наборе. Мегабайт
   * считается за 26 мс (замер задачи 149); больше — по щелчку: пауза
   * в наборе не должна оборачиваться задержкой следующей буквы (инвариант 6).
   */
  const WORD_COUNT_LIMIT = 1024 * 1024;
  /** Пауза в наборе перед подсчётом — как у счётчика совпадений. */
  const WORD_COUNT_DELAY = 150;

  interface WordCounts {
    /** Чей счёт: при смене вкладки чужие числа не показываются. */
    tab: number;
    /** Какой текст посчитан — у большого файла счёт живёт до правки. */
    doc: Text;
    all: Counts;
    selected: Counts | null;
  }

  let counted = $state<WordCounts | null>(null);
  const tooBig = $derived(countable && (shown?.doc.length ?? 0) > WORD_COUNT_LIMIT);

  function countNow(): void {
    const state = shown;
    if (!tab || !state) return;
    const markdown = languageOf(tab)?.id === 'markdown';
    counted = {
      tab: tab.meta.id,
      doc: state.doc,
      all: countAll(state, markdown),
      selected: countSelection(state),
    };
  }

  $effect(() => {
    const state = shown;
    if (!countable || !state) return;
    if (state.doc.length > WORD_COUNT_LIMIT) {
      // Большой файл: счёт по щелчку, и после правки он уже неправда.
      if (untrack(() => counted)?.doc !== state.doc) counted = null;
      return;
    }
    const timer = setTimeout(countNow, WORD_COUNT_DELAY);
    return () => clearTimeout(timer);
  });

  const words = $derived(counted !== null && counted.tab === tab?.meta.id ? counted : null);

  /**
   * «12 из 1 234 слов»: форма слова — по общему числу, выделенное
   * подставляется в неё с разрядами, как и общее.
   */
  function wordLabel(value: WordCounts): string {
    const all = value.all.words;
    if (value.selected) {
      return tn('status.words.selected', all, { selected: formatNumber(value.selected.words) });
    }
    return tn('status.words', all);
  }

  function wordTitle(value: WordCounts): string {
    const markdown = tab ? languageOf(tab)?.id === 'markdown' : false;
    const text = value.selected
      ? t('status.words.hint.selected', {
          words: formatNumber(value.selected.words),
          allWords: formatNumber(value.all.words),
          chars: formatNumber(value.selected.chars),
          allChars: formatNumber(value.all.chars),
        })
      : t('status.words.hint', {
          words: formatNumber(value.all.words),
          chars: formatNumber(value.all.chars),
        });
    return markdown ? `${text} ${t('status.words.properties')}` : text;
  }

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

  /** Полное имя переноса строк для меню; у CR имя системы — словами. */
  function eolFull(eol: LineEnding): string {
    switch (eol) {
      case 'cr-lf':
        return 'CRLF — Windows';
      case 'lf':
        return 'LF — Unix';
      case 'cr':
        return t('status.eol.cr');
    }
  }

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
        section: index === 0 ? t('status.encoding.reinterpret') : undefined,
        checked: e.id === current,
        disabled: !hasFile,
        hint: hasFile
          ? t('status.encoding.reinterpret.hint')
          : t('status.encoding.reinterpret.no-file'),
      })),
      ...ENCODINGS.map((e, index) => ({
        id: `convert:${e.id}`,
        label: e.label,
        section: index === 0 ? t('status.encoding.convert') : undefined,
        checked: e.id === current,
        hint: t('status.encoding.convert.hint'),
      })),
      {
        id: 'bom',
        label: t('status.encoding.bom'),
        section: t('status.encoding.saving'),
        checked: tab.meta.bom,
        disabled: !supportsBom,
        hint: supportsBom ? t('status.encoding.bom.hint') : t('status.encoding.bom.none'),
      },
    ];
  });

  const eolItems = $derived.by((): PopupItem[] => {
    if (!tab) return [];
    return (['cr-lf', 'lf', 'cr'] as LineEnding[]).map((eol) => ({
      id: eol,
      label: eolFull(eol),
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
        label: t('status.indent.spaces'),
        section: t('status.indent.style'),
        checked: current.style === 'spaces',
      },
      { id: 'style:tabs', label: t('status.indent.tabs'), checked: current.style === 'tabs' },
      ...WIDTHS.map((width, index) => ({
        id: `width:${width}`,
        label: String(width),
        section: index === 0 ? t('status.indent.width') : undefined,
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
        label: doc ? t('status.scale.fit.pdf') : t('status.scale.fit.image'),
        section: t('status.scale'),
        checked: viewed.scale === 'fit',
        hint: doc ? t('status.scale.fit.pdf.hint') : t('status.scale.fit.image.hint'),
      },
      ...ZOOM_STEPS.map((step) => ({
        id: String(step),
        label: scaleLabel(step),
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
        label: autoLanguage
          ? t('status.language.auto.named', { language: autoLanguage.label })
          : t('status.language.auto'),
        section: t('status.language.section'),
        checked: ed.language === null,
        hint: t('status.language.auto.hint'),
      },
      {
        id: 'none',
        label: t('status.language.none'),
        checked: ed.language === 'none',
      },
      ...LANGUAGES.map((lang, index) => ({
        id: lang.id,
        label: lang.label,
        section: index === 0 ? t('status.language.pick') : undefined,
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
      {look.portable ? t('status.data.portable') : t('status.data.fallback')}
    </span>
  {/if}

  {#if indexing.progress.running}
    <span class="item" title={t('status.index.hint')}>
      {#if indexing.progress.total > 0}
        {t('status.index.progress', { done: indexing.progress.done, total: indexing.progress.total })}
      {:else}
        {t('status.index.walking')}
      {/if}
    </span>
    <button
      class="item action"
      type="button"
      onclick={cancelIndexing}
      title={t('status.index.stop')}
      aria-label={t('status.index.stop')}
    >
      <Icon name="action.remove" />
    </button>
  {/if}

  <span class="spacer"></span>

  {#if countable}
    {#if words}
      <span class="item" title={wordTitle(words)}>{wordLabel(words)}</span>
    {:else if tooBig}
      <button
        class="item action"
        type="button"
        onclick={countNow}
        title={t('status.words.count.hint')}
      >
        {t('status.words.count')}
      </button>
    {/if}
  {/if}

  {#if position}
    <button
      class="item action"
      type="button"
      onclick={() => void goToLineDialog()}
      title={goToLineKey
        ? t('status.position.hint.key', {
            line: position.line,
            lines,
            column: position.column,
            key: labelOf(goToLineKey),
          })
        : t('status.position.hint', { line: position.line, lines, column: position.column })}
    >
      {positionLabel(position)}
    </button>
  {/if}

  {#if cursors > 1}
    <span class="item accent" title={t('status.cursors.hint')}>
      {tn('status.cursors', cursors)}
    </span>
  {/if}

  <!--
    У картинки свои свойства и свои же три места в строке: настоящий размер,
    вес файла и масштаб показа. Кодировки и переносов у неё нет (Р-180).
  -->
  {#if tab && img}
    {#if img.width > 0}
      <span class="item" title={t('status.image.size.hint')}>
        {img.width} × {img.height}
      </span>
    {/if}

    {#if tab.meta.disk}
      <span class="item" title={t('status.file.size.hint')}>{fileSize(tab.meta.disk.size)}</span>
    {/if}

    <button
      class="item action"
      type="button"
      title={t('status.image.scale.hint')}
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
      title={goToLineKey
        ? t('status.pdf.go-to.key', { key: labelOf(goToLineKey) })
        : t('status.pdf.go-to')}
      onclick={() => void goToPageDialog(doc)}
    >
      {doc.pages > 0
        ? t('status.pdf.page', { page: doc.page, pages: doc.pages })
        : t('status.pdf.opening')}
    </button>

    {#if tab.meta.disk}
      <span class="item" title={t('status.file.size.hint')}>{fileSize(tab.meta.disk.size)}</span>
    {/if}

    <button
      class="item action"
      type="button"
      title={t('status.pdf.scale.hint')}
      onclick={(e) => toggle('scale', e)}
    >
      {scaleLabel(doc.scale, true)}
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
        ? t('status.wrap.hint.readable')
        : wrapEnabled()
          ? t('status.wrap.hint.on')
          : t('status.wrap.hint.off')}
      onclick={() => void toggleWrap()}
    >
      {wrapOf(tab) ? t('status.wrap.on') : t('status.wrap.off')}
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
        title={livePreviewOf(tab) ? t('status.preview.hint.on') : t('status.preview.hint.off')}
        onclick={() => void toggleLivePreview()}
      >
        {livePreviewOf(tab) ? t('status.preview.on') : t('status.preview.off')}
      </button>
    {/if}

    {#if tab.meta.readOnly}
      <span class="item warn" title={t('status.read-only.hint')}>
        {tab.meta.large ? t('status.read-only.large') : t('status.read-only')}
      </span>
    {/if}

    {#if tab.meta.lossy}
      <span class="item warn" title={t('status.lossy.hint')}>
        <Icon name="status.warning" />
        {t('status.lossy')}
      </span>
    {/if}

    <button
      class="item action"
      type="button"
      title={t('status.indent.hint', { source: indentSource(ed.indent) })}
      onclick={(e) => toggle('indent', e)}
    >
      {indentLabel(ed.indent)}
    </button>

    <button
      class="item action"
      type="button"
      title={ed.language === null
        ? t('status.language.hint.auto')
        : t('status.language.hint.manual')}
      onclick={(e) => toggle('language', e)}
    >
      {language ? language.label : t('status.language.plain')}
    </button>

    <button
      class="item action"
      class:warn={tab.meta.eolMixed}
      type="button"
      title={tab.meta.eolMixed ? t('status.eol.hint.mixed') : t('status.eol.hint')}
      onclick={(e) => toggle('eol', e)}
    >
      {tab.meta.eolMixed
        ? t('status.eol.mixed', { eol: EOL_LABEL[tab.meta.eol] })
        : EOL_LABEL[tab.meta.eol]}
    </button>

    <button
      class="item action"
      class:uncertain={!tab.meta.encodingConfident}
      type="button"
      title={tab.meta.encodingConfident
        ? t('status.encoding.hint')
        : t('status.encoding.hint.uncertain')}
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
