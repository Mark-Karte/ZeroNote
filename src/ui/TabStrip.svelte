<script lang="ts">
  import Icon from './Icon.svelte';
  import { kindOf, iconForKind } from '../icons/files';
  import { tabs, setActive, moveLocal, commitOrder, tabById } from '../state/tabs.svelte';
  // Закрытие идёт через действие, а не напрямую через состояние: только там
  // спрашивают про несохранённые правки.
  import { closeTab, closeOtherTabs, revealInExplorer } from '../actions/files';
  import { copyText } from '../actions/clipboard';
  import { showMenu } from '../state/menu.svelte';
  import { tabMenu, MENU } from './menus';
  import { commandList } from '../keymap/global.svelte';
  import { runCommand } from '../keymap/registry';
  import { nextIndex, type TabBox } from './tab-drag';

  /**
   * Перетаскивание вкладок сделано на событиях указателя, а не на
   * HTML5 drag-and-drop. Причины: последний навязывает своё «призрачное»
   * изображение, по-разному ведёт себя в разных движках и не даёт
   * отследить положение точно. Здесь же всё под контролем.
   */
  let strip: HTMLDivElement;

  /** Нажатие произошло, но перетаскиванием ещё не стало. */
  let pressed: { id: number; startX: number } | null = null;
  let dragging = $state<number | null>(null);

  /**
   * Сколько нужно проехать мышью, чтобы нажатие стало перетаскиванием.
   *
   * Без этого порога обычный щелчок переставляет вкладку: палец всегда
   * сдвигает мышь на пиксель-другой, и этого хватало, чтобы сработал перенос.
   */
  const DRAG_THRESHOLD = 5;

  /** Снять положения вкладок с разметки для расчёта в `tab-drag.ts`. */
  function measure(): TabBox[] {
    return Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]')).map(
      (element) => {
        const box = element.getBoundingClientRect();
        return {
          id: Number(element.dataset['tabId']),
          left: box.left,
          width: box.width,
        };
      },
    );
  }

  function onPointerDown(event: PointerEvent, id: number): void {
    // Средняя кнопка закрывает вкладку — привычка из браузеров и Notepad++.
    if (event.button === 1) {
      event.preventDefault();
      void closeTab(id);
      return;
    }
    if (event.button !== 0) return;

    setActive(id);
    pressed = { id, startX: event.clientX };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pressed) return;

    // Главная защита от «вкладка уехала сама»: перетаскивания не бывает,
    // если кнопка мыши не нажата. Событие отпускания можно не получить —
    // окно потеряло фокус, захват указателя сорвался, — и тогда `pressed`
    // осталось бы висеть, превращая следующее же движение мыши в перенос.
    if (event.buttons === 0) {
      finishDrag();
      return;
    }

    if (dragging === null) {
      if (Math.abs(event.clientX - pressed.startX) < DRAG_THRESHOLD) return;
      dragging = pressed.id;
    }

    const target = nextIndex(measure(), dragging, event.clientX);
    if (target !== null) {
      moveLocal(dragging, target);
    }
  }

  function finishDrag(): void {
    // Итоговый порядок уходит в ядро один раз, а не на каждый шаг мыши.
    if (dragging !== null) {
      void commitOrder(dragging);
    }
    pressed = null;
    dragging = null;
  }

  /**
   * Меню вкладки.
   *
   * Вкладка под указателем сначала становится активной, и только потом
   * открывается меню. Иначе «Сохранить» из меню третьей вкладки сохранило бы
   * первую: команды реестра работают с активной вкладкой, а не с той,
   * по которой щёлкнули. Notepad++ делает так же.
   */
  function onContextMenu(event: MouseEvent, id: number): void {
    setActive(id);

    const tab = tabById(id);
    if (!tab) return;
    const meta = tab.meta;

    showMenu(
      event,
      tabMenu(
        {
          modified: meta.modified,
          hasFile: meta.path !== null,
          others: tabs.items.length - 1,
        },
        commandList(),
      ),
      (choice) => {
        switch (choice) {
          case MENU.closeOthers:
            void closeOtherTabs(id);
            return;
          case MENU.copyPath:
            if (meta.path) void copyText(meta.path);
            return;
          case MENU.copyName:
            void copyText(meta.title);
            return;
          case MENU.reveal:
            if (meta.path) void revealInExplorer(meta.path);
            return;
          default:
            runCommand(choice);
        }
      },
    );
  }

  function onPointerUp(event: PointerEvent): void {
    const element = event.currentTarget as HTMLElement;
    // Захват мог быть уже потерян: тогда освобождение бросает исключение,
    // и без перехвата всё, что идёт следом, просто не выполнится.
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    finishDrag();
  }
</script>

<div class="strip" bind:this={strip} role="tablist">
  {#each tabs.items as tab (tab.meta.id)}
    <div
      class="tab"
      class:active={tab.meta.id === tabs.activeId}
      class:dragging={tab.meta.id === dragging}
      data-tab-id={tab.meta.id}
      role="tab"
      tabindex="-1"
      aria-selected={tab.meta.id === tabs.activeId}
      title={tab.meta.path ?? tab.meta.title}
      onpointerdown={(e) => onPointerDown(e, tab.meta.id)}
      oncontextmenu={(e) => onContextMenu(e, tab.meta.id)}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onlostpointercapture={finishDrag}
    >
      <span class="kind" data-kind={kindOf(tab.meta.title)}>
        <Icon name={iconForKind(kindOf(tab.meta.title))} />
      </span>
      <span class="name">{tab.meta.title}</span>
      <button
        class="close"
        class:modified={tab.meta.modified}
        type="button"
        title={tab.meta.modified ? 'Закрыть (есть несохранённые правки)' : 'Закрыть'}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => closeTab(tab.meta.id)}
      >
        <Icon name={tab.meta.modified ? 'tab.modified' : 'tab.close'} />
      </button>
    </div>
  {/each}
</div>

<style>
  .strip {
    display: flex;
    flex: none;
    align-items: stretch;
    /* Зазора между вкладками нет: их разделяет черта, а не пустота.
       Пустота между одинаковыми прямоугольниками не делит их, а размывает —
       именно так полоса вкладок и выглядела до задачи 56. */
    gap: 0;
    height: var(--zn-control-tab-height);
    /* Полосы окна — шапка, вкладки, строка состояния — начинаются
       от одной вертикали. До задачи 56 их было три разных. */
    padding-inline: var(--zn-space-4);
    background-color: var(--zn-color-bg-surface);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  /* Вкладка — карточка со скруглённым верхом, как в референсе: нижние углы
     прямые, потому что вкладка стоит на рабочей области, а не висит в воздухе. */
  .tab {
    position: relative;
    display: flex;
    flex: 0 1 var(--zn-control-tab-max-width);
    min-width: var(--zn-control-tab-min-width);
    align-items: center;
    gap: var(--zn-space-2);
    padding-inline: var(--zn-space-3);
    border: var(--zn-border-width) solid transparent;
    border-block-end: none;
    border-start-start-radius: var(--zn-radius-lg);
    border-start-end-radius: var(--zn-radius-lg);
    color: var(--zn-color-fg-subtle);
    cursor: default;
    user-select: none;
    transition: background-color var(--zn-motion-duration-fast) var(--zn-motion-easing);
  }

  /* Черта между вкладками. Не во всю высоту: короткая черта делит, длинная
     нарезает полосу на клетки. */
  .tab::after {
    content: '';
    position: absolute;
    inset-block: var(--zn-space-3);
    inset-inline-end: 0;
    width: var(--zn-border-width);
    background-color: var(--zn-color-border-subtle);
  }

  /*
   * Где черты нет.
   *
   * У последней вкладки — потому что делить не с кем. У активной и у её
   * левой соседки — потому что край карточки уже проведён и вторая линия
   * рядом с ним читается как дрожание. То же у вкладки под курсором:
   * заливка сама себе граница.
   *
   * `:has` выбирает вкладку по её соседке справа — иначе «предыдущую перед
   * активной» в CSS не достать.
   */
  .tab:last-child::after,
  .tab.active::after,
  .tab:has(+ .tab.active)::after,
  .tab:hover::after,
  .tab:has(+ .tab:hover)::after {
    display: none;
  }

  .tab:hover {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-muted);
  }

  /* Активная вкладка — карточка рабочей области, поднятая на полосу,
     плюс акцентная черта сверху: издалека видно, где ты, не читая имён.
     Черта внутренней тенью, а не рамкой: рамка сдвинула бы содержимое
     вкладки на пиксель вниз. */
  .tab.active {
    background-color: var(--zn-color-bg-raised);
    border-color: var(--zn-color-border-subtle);
    box-shadow: inset 0 var(--zn-border-width-thick) 0 var(--zn-color-accent);
    color: var(--zn-color-fg-default);
  }

  .tab.dragging {
    opacity: 0.6;
  }

  /* Цвет значка по виду файла. Роли задаёт тема, а какое расширение к какой
     относится — icons/files.ts. Признаком в разметке, а не классом: значений
     ровно столько, сколько ролей, и список виден целиком. */
  .kind {
    display: inline-flex;
    flex: none;
  }

  .kind[data-kind='note'] {
    color: var(--zn-color-file-note);
  }

  .kind[data-kind='code'] {
    color: var(--zn-color-file-code);
  }

  .kind[data-kind='data'] {
    color: var(--zn-color-file-data);
  }

  .kind[data-kind='other'] {
    color: var(--zn-color-file-other);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--zn-font-size-ui-small);
  }

  .close {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    padding: var(--zn-space-1);
    border: none;
    border-radius: var(--zn-radius-sm);
    background-color: transparent;
    color: var(--zn-color-fg-subtle);
    cursor: default;
    /* Крестик появляется по наведению; точка изменённого файла видна всегда,
       иначе несохранённые правки было бы не заметить. */
    opacity: 0;
  }

  .tab:hover .close,
  .tab.active .close,
  .close.modified {
    opacity: 1;
  }

  .close:hover {
    background-color: var(--zn-color-bg-active);
    color: var(--zn-color-fg-default);
  }

  .strip::-webkit-scrollbar {
    height: var(--zn-space-1);
  }

  .strip::-webkit-scrollbar-thumb {
    background-color: var(--zn-color-border-default);
  }
</style>
