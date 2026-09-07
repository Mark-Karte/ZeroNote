<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import * as pdfjs from 'pdfjs-dist';
  import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
  import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

  import Icon from './Icon.svelte';
  import * as ipc from '../ipc/files';
  import { activeTab, tabById, type PdfState } from '../state/tabs.svelte';
  import { revealInExplorer } from '../actions/files';
  import { setPdfView } from '../pdf/current';

  /**
   * Показ PDF — и только показ (Р-181).
   *
   * Открыть, пролистать, увидеть номер страницы, изменить масштаб. Ни правки,
   * ни аннотаций, ни форм, ни печати, ни поиска — последнее решение владельца.
   *
   * **Политика безопасности окна не менялась** (Р-182). Байты приходят из ядра
   * через IPC двоичным ответом; рабочий поток pdf.js собирается вместе
   * с фронтендом и грузится с нашего же адреса, то есть из `'self'`;
   * `unsafe-eval` шестая версия pdf.js не просит вовсе — из неё убрали
   * последнее место, где вычислялся код на лету.
   *
   * Отсюда же два известных ограничения, названных честно: таблиц соответствия
   * для восточных кодировок и данных стандартных шрифтов мы не возим — они
   * подгружаются сетевыми запросами, а `connect-src` у нас только `ipc:`.
   * Для встроенных в документ шрифтов — а это подавляющее большинство файлов —
   * ничего этого не нужно.
   */

  pdfjs.GlobalWorkerOptions.workerSrc = workerSource;

  /**
   * Отступ страницы от края области.
   *
   * Читается из того же токена, которым задан в разметке: два числа об одном
   * и том же разъезжаются молча, а от этого зависит и прокрутка к странице,
   * и ширина, по которой считается масштаб.
   */
  function gutter(): number {
    if (!host) return 0;
    const value = getComputedStyle(host).paddingTop;
    return Number.parseFloat(value) || 0;
  }

  const tab = $derived(activeTab());
  const shown = $derived(tab?.pdf ?? null);

  let host = $state<HTMLDivElement | null>(null);
  let boxes = $state<(HTMLDivElement | null)[]>([]);

  /** Ширина области показа. Нужна масштабу «по ширине» и меняется с окном. */
  let available = $state(0);

  /**
   * Разобранный документ, наблюдатель видимости и отметка «уже спросили».
   *
   * Обычные переменные, а не руны: интерфейс от них не зависит, а держать
   * документ pdf.js в реактивном состоянии значило бы оборачивать в прокси
   * объект с сотней полей и рабочим потоком внутри.
   */
  let doc: PDFDocumentProxy | null = null;
  /**
   * Задача загрузки. Держится ради `destroy`: закрывает и документ,
   * и рабочий поток — у самого документа такого способа нет.
   */
  let task: PDFDocumentLoadingTask | null = null;
  let watcher: IntersectionObserver | null = null;
  let asked: number | null = null;
  /**
   * Размер первой страницы при масштабе 1 — от него считаются заготовки.
   *
   * Руна, а не обычная переменная, и это стоило живой проверки: от неё
   * зависит `scale`, а тот пересчитывается только по руне. С обычной
   * переменной масштаб оставался единицей, заготовки страниц выходили ниже
   * настоящих, и переход к третьей странице увозил в конец документа.
   */
  let base = $state({ width: 0, height: 0 });
  /** Страницы, которые рисуются прямо сейчас. */
  const drawing = new Set<number>();

  const scale = $derived.by(() => {
    if (!shown) return 1;
    if (shown.scale !== 'fit') return shown.scale;
    if (base.width <= 0 || available <= 0) return 1;
    // По ширине, а не «вписать целиком»: у страницы важна ширина — по ней
    // набрана строка. И в отличие от картинки маленькую страницу растянуть
    // можно и нужно: лист в 612 точек на большом экране иначе будет с ладонь.
    return (available - gutter() * 2) / base.width;
  });

  // Байты спрашиваются, когда вкладка появляется на экране, и отпускаются,
  // когда она уходит (Р-193).
  $effect(() => {
    const current = tab;
    const pdf = current?.pdf ?? null;
    if (!current || !pdf) return;
    if (pdf.problem !== null || asked === current.meta.id) return;

    asked = current.meta.id;
    void load(current.meta.id, pdf);
  });

  // Уход с вкладки закрывает документ: и байты, и рабочий поток pdf.js.
  $effect(() => {
    const id = tab?.meta.id ?? null;

    return () => {
      release();
      if (id !== null) {
        const pdf = tabById(id)?.pdf;
        if (pdf) pdf.problem = null;
        if (asked === id) asked = null;
      }
    };
  });

  // Размер области нужен масштабу «по ширине» — и обязан следовать за окном.
  $effect(() => {
    const element = host;
    if (!element) return;

    const sizes = new ResizeObserver(() => {
      available = element.clientWidth;
    });
    sizes.observe(element);
    available = element.clientWidth;

    return () => sizes.disconnect();
  });

  // Смена масштаба перерисовывает то, что видно, и пересчитывает заготовки.
  $effect(() => {
    const factor = scale;
    void shown?.pages;
    untrack(() => resize(factor));
  });

  onDestroy(() => {
    release();
    setPdfView(null);
  });

  async function load(id: number, pdf: PdfState): Promise<void> {
    try {
      const bytes = await ipc.pdfBytes(id);
      const started = pdfjs.getDocument({ data: new Uint8Array(bytes) });
      const opened = await started.promise;

      // Пока читали, вкладку могли закрыть или сменить.
      if (asked !== id) {
        void started.destroy();
        return;
      }

      task = started;
      doc = opened;
      const first = await opened.getPage(1);
      const viewport = first.getViewport({ scale: 1 });
      base = { width: viewport.width, height: viewport.height };

      untrack(() => {
        pdf.pages = opened.numPages;
      });

      setPdfView({ goToPage });

      // `tick`, а не микрозадача: заготовки страниц создаёт Svelte, и до
      // окончания его перерисовки прокручивать не к чему. Микрозадача
      // выполняется раньше — с ней прокрутка уезжала не туда.
      await tick();
      resize(scale);
      goToPage(pdf.page);
    } catch (error) {
      untrack(() => {
        pdf.problem = String(error);
      });
    }
  }

  function release(): void {
    watcher?.disconnect();
    watcher = null;
    drawing.clear();
    boxes = [];
    doc = null;
    if (task) {
      // Закрывает и документ, и рабочий поток: байты не переживают вкладку.
      void task.destroy();
      task = null;
    }
  }

  /** Пересчитать заготовки под новый масштаб и перерисовать видимое. */
  function resize(factor: number): void {
    if (!doc || base.height <= 0) return;

    for (const box of boxes) {
      if (!box) continue;
      box.style.height = `${Math.round(base.height * factor)}px`;
      const canvas = box.querySelector('canvas');
      // Отметка сбрасывается: то, что нарисовано в прошлом масштабе,
      // придётся нарисовать заново.
      if (canvas) delete canvas.dataset['drawn'];
    }

    observe();
  }

  /**
   * Рисуются только видимые страницы, остальные — пустые заготовки нужной
   * высоты.
   *
   * Иначе документ в пятьсот страниц означал бы пятьсот холстов в памяти
   * окна, и открытие такого файла было бы не показом, а зависанием.
   */
  function observe(): void {
    if (!host) return;
    watcher?.disconnect();

    watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset['page']);
          if (entry.isIntersecting) void draw(page);
          else clear(page);
        }
      },
      // Запас в пол-экрана: страница успевает нарисоваться до того,
      // как до неё долистали.
      { root: host, rootMargin: '50% 0px' },
    );

    for (const box of boxes) {
      if (box) watcher.observe(box);
    }
  }

  async function draw(page: number): Promise<void> {
    const box = boxes[page - 1];
    const canvas = box?.querySelector('canvas');
    if (!doc || !box || !canvas || drawing.has(page)) return;

    const factor = scale;
    if (canvas.dataset['drawn'] === String(factor)) return;

    drawing.add(page);
    try {
      const source = await doc.getPage(page);
      const viewport = source.getViewport({ scale: factor });

      // Холст в точках устройства, а размер в разметке — в точках CSS:
      // на экране с удвоенной плотностью иначе получится мыло.
      const density = window.devicePixelRatio || 1;
      canvas.width = Math.round(viewport.width * density);
      canvas.height = Math.round(viewport.height * density);
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;
      box.style.height = `${Math.round(viewport.height)}px`;

      await source.render({
        canvas,
        viewport,
        // Показ, и только показ (Р-181): аннотации и поля форм не рисуются
        // вовсе — не потому, что их нечем нарисовать, а потому, что мы
        // не собираемся давать их править.
        annotationMode: pdfjs.AnnotationMode.DISABLE,
        transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0],
      }).promise;

      canvas.dataset['drawn'] = String(factor);
    } catch {
      // Страница не нарисовалась — остальные от этого не страдают. Пустая
      // заготовка на её месте честнее, чем сообщение поверх всего документа.
    } finally {
      drawing.delete(page);
    }
  }

  /** Освободить холст ушедшей страницы: нулевой размер отпускает память. */
  function clear(page: number): void {
    const canvas = boxes[page - 1]?.querySelector('canvas');
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
    delete canvas.dataset['drawn'];
  }

  function goToPage(page: number): void {
    if (!host || !shown) return;
    const box = boxes[Math.min(Math.max(page, 1), shown.pages) - 1];
    if (box) host.scrollTop = box.offsetTop - gutter();
  }

  let ticking = false;

  function onScroll(): void {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      updatePage();
    });
  }

  /** Перед глазами та страница, чей верх последним ушёл выше края области. */
  function updatePage(): void {
    if (!host || !shown) return;

    const top = host.scrollTop + gutter() * 2;
    let current = 1;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (!box) continue;
      if (box.offsetTop > top) break;
      current = index + 1;
    }

    if (shown.page !== current) shown.page = current;
  }
</script>

{#if shown?.problem}
  <div class="empty">
    <div class="card">
      <Icon name="status.warning" />
      <p class="what">{tab?.meta.title}</p>
      <p class="why">{shown.problem}</p>
      {#if tab?.meta.path}
        <button class="reveal" type="button" onclick={() => void revealInExplorer(tab.meta.path!)}>
          Показать в проводнике
        </button>
      {/if}
    </div>
  </div>
{:else}
  <div class="scroll" bind:this={host} onscroll={onScroll}>
    {#if shown}
      {#each Array.from({ length: shown.pages }, (_, index) => index + 1) as page (page)}
        <div class="page" data-page={page} bind:this={boxes[page - 1]}>
          <canvas></canvas>
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .scroll {
    /* `relative` не украшение: положение заготовок считается от этого
       элемента, и на нём же держится и прокрутка к странице, и определение
       той, что перед глазами. */
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    gap: var(--zn-space-5);
    padding: var(--zn-space-5);
    overflow: auto;
    background-color: var(--zn-color-bg-canvas);
  }

  /* Лист на подложке, как в любом просмотрщике.
     Цвет здесь — наш, и он токен: это заготовка, которую видно, пока страница
     не нарисована. Саму бумагу красит pdf.js, и красит в белый — потому что
     белая она в документе, а не потому, что так решила тема. */
  .page {
    flex: none;
    background-color: var(--zn-color-bg-raised);
    box-shadow: var(--zn-shadow-raised);
  }

  canvas {
    display: block;
  }

  .empty {
    display: flex;
    flex: 1;
    min-height: 0;
    align-items: center;
    justify-content: center;
    padding: var(--zn-space-6);
    background-color: var(--zn-color-bg-raised);
  }

  .card {
    display: flex;
    max-width: var(--zn-control-page-width);
    flex-direction: column;
    align-items: center;
    gap: var(--zn-space-3);
    padding: var(--zn-space-6);
    border: var(--zn-border-width) solid var(--zn-color-border-subtle);
    border-radius: var(--zn-radius-lg);
    color: var(--zn-color-warning);
    text-align: center;
  }

  .what {
    margin: 0;
    color: var(--zn-color-fg-default);
    font-weight: var(--zn-font-weight-strong);
  }

  .why {
    margin: 0;
    color: var(--zn-color-fg-muted);
  }

  .reveal {
    padding: var(--zn-space-2) var(--zn-space-4);
    border: var(--zn-border-width) solid var(--zn-color-border-default);
    border-radius: var(--zn-radius-sm);
    background-color: transparent;
    color: var(--zn-color-fg-default);
    font-family: inherit;
    font-size: var(--zn-font-size-ui);
    cursor: default;
  }

  .reveal:hover {
    background-color: var(--zn-color-bg-hover);
  }
</style>
