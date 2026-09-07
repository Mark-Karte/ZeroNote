<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import * as ipc from '../ipc/files';
  import { activeTab, tabById, type ImageState } from '../state/tabs.svelte';
  import { revealInExplorer } from '../actions/files';
  import { effectiveScale, stepFrom } from './zoom';

  /**
   * Вкладка с картинкой.
   *
   * Байты сюда приезжают из ядра адресом `data:` (Р-182) и живут ровно
   * столько, сколько вкладка на экране (Р-193): уходя, показ их отпускает.
   * Поэтому возврат на вкладку перечитывает файл — заодно и обновляет
   * картинку, если её подменили на диске.
   */

  const tab = $derived(activeTab());
  const image = $derived(tab?.image ?? null);

  let box = $state<HTMLDivElement | null>(null);

  /**
   * Для какой вкладки запрос уже отправлен.
   *
   * Обычная переменная, а не руна: эффект ниже пишет в то же состояние,
   * которое читает, и без этой отметки он звал бы себя заново.
   */
  let asked: number | null = null;

  // Байты спрашиваются, когда их нет: при появлении вкладки, при возврате
  // на неё и после повторного открытия того же файла.
  $effect(() => {
    const current = tab;
    const state = current?.image ?? null;
    if (!current || !state) return;
    if (state.source !== null || state.problem !== null) return;
    if (asked === current.meta.id) return;

    asked = current.meta.id;
    void load(current.meta.id, state);
  });

  // Уход с вкладки отпускает байты. Иначе десять открытых картинок означали бы
  // десять картинок в памяти окна, а нужна одна — та, что на экране.
  $effect(() => {
    const id = tab?.meta.id ?? null;

    return () => {
      if (id === null) return;
      const state = tabById(id)?.image;
      if (state) {
        state.source = null;
        state.problem = null;
      }
      if (asked === id) asked = null;
    };
  });

  async function load(id: number, state: ImageState): Promise<void> {
    try {
      const source = await ipc.imageSource(id);
      // `untrack`: присваивание идёт в то же состояние, от которого зависит
      // эффект выше, и без этого он вызвал бы сам себя.
      untrack(() => {
        state.source = source;
      });
    } catch (error) {
      untrack(() => {
        state.problem = String(error);
      });
    }
  }

  /** Настоящий размер узнаётся только после разбора картинки движком. */
  function onLoad(event: Event): void {
    const element = event.currentTarget as HTMLImageElement;
    if (!image) return;
    image.width = element.naturalWidth;
    image.height = element.naturalHeight;
  }

  /**
   * Файл назвался картинкой, но ею не оказался.
   *
   * Такое бывает не только с испорченным файлом: расширение мог поменять
   * человек. Притворяться, что открыли, нельзя — говорим прямо.
   */
  function onError(): void {
    if (!image) return;
    image.source = null;
    image.problem = 'файл не открылся как картинка: он повреждён или это не картинка вовсе';
  }

  /** Щелчок переключает «по окну» и настоящий размер — как во всех просмотрщиках. */
  function toggle(): void {
    if (!image) return;
    image.scale = image.scale === 'fit' ? 1 : 'fit';
  }

  function onWheel(event: WheelEvent): void {
    // Без Ctrl колесо прокручивает — у увеличенной картинки это единственный
    // способ её подвинуть.
    if (!event.ctrlKey || !image || !box) return;
    event.preventDefault();

    const current = effectiveScale(
      image.scale,
      { width: image.width, height: image.height },
      { width: box.clientWidth, height: box.clientHeight },
    );
    image.scale = stepFrom(current, event.deltaY < 0 ? 1 : -1);
  }

  /** Ширина в точках для заданного масштаба. Пусто — вписываем в окно. */
  const sized = $derived.by(() => {
    if (!image || image.scale === 'fit' || image.width === 0) return '';
    return `width: ${Math.round(image.width * image.scale)}px;`;
  });
</script>

{#if image?.problem}
  <div class="empty">
    <div class="card">
      <Icon name="status.warning" />
      <p class="what">{tab?.meta.title}</p>
      <p class="why">{image.problem}</p>
      {#if tab?.meta.path}
        <button class="reveal" type="button" onclick={() => void revealInExplorer(tab.meta.path!)}>
          Показать в проводнике
        </button>
      {/if}
    </div>
  </div>
{:else}
  <!-- Клетчатая подложка: без неё прозрачный PNG на тёмной теме выглядит
       чёрным прямоугольником, и понять, где у него край, нельзя.
       Предупреждение снято сознательно: щёлкают по самой картинке, а она
       здесь и есть содержимое, обёртка же только прокручивается. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="canvas" bind:this={box} onwheel={onWheel}>
    {#if image?.source}
      <!-- Щелчок по картинке переключает масштаб — так делают все
           просмотрщики. Предупреждения сняты осознанно: то же действие
           есть в строке состояния, куда добираются с клавиатуры,
           а превращать картинку в кнопку значило бы обернуть её лишним
           элементом ради того, что уже доступно. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <img
        class="picture"
        class:fit={image.scale === 'fit'}
        style={sized}
        src={image.source}
        alt={tab?.meta.title ?? ''}
        onload={onLoad}
        onerror={onError}
        onclick={toggle}
        title={image.scale === 'fit' ? 'Настоящий размер' : 'Вписать в окно'}
      />
    {/if}
  </div>
{/if}

<style>
  .canvas {
    display: flex;
    flex: 1;
    min-height: 0;
    align-items: center;
    justify-content: center;
    padding: var(--zn-space-4);
    overflow: auto;
    /* Клетка из двух фонов окна: своих цветов у неё нет, значит и в новой теме
       она встанет сама. Клетка мелкая — она подложка, а не узор. */
    background-color: var(--zn-color-bg-raised);
    background-image: repeating-conic-gradient(
      var(--zn-color-bg-canvas) 0% 25%,
      transparent 0% 50%
    );
    background-size: var(--zn-space-5) var(--zn-space-5);
  }

  .picture {
    /* Настоящий размер по умолчанию, ужимается только если не влезает.
       Растягивать маленькую картинку на всё окно нельзя: значок в шестнадцать
       точек превратился бы в кашу из квадратов. */
    flex: none;
    display: block;
    cursor: zoom-in;
    /* Точки видно точками: у увеличенного снимка экрана сглаживание
       превращает текст в размытое пятно. */
    image-rendering: pixelated;
  }

  .picture.fit {
    max-width: 100%;
    max-height: 100%;
    cursor: zoom-out;
    /* На своём размере и меньше сглаживание, наоборот, нужно. */
    image-rendering: auto;
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
