<script lang="ts">
  import Icon from '../Icon.svelte';
  import { dailyNotesOfMonth } from '../../ipc/notes';
  import { openDaily, stamp } from '../../actions/daily';
  import { monthGrid, monthKey, monthLabel, shiftMonth, type Cell } from '../calendar';

  /**
   * Календарь ежедневных заметок (задача 97).
   *
   * Показывает месяц и помечает дни, за которые заметка уже написана.
   * Щелчок по дню открывает её — или создаёт, той же командой, что и
   * «Заметка на сегодня»: другой дороги к ежедневной заметке в приложении
   * нет и заводить её незачем.
   *
   * Месяц считает окно, а не ядро: у ядра нет часового пояса (Р-228).
   */

  const today = stamp(new Date()).date;

  let year = $state(Number(today.slice(0, 4)));
  let month = $state(Number(today.slice(5, 7)));
  let written: number[] = $state([]);

  const weeks = $derived(monthGrid(year, month));

  /**
   * Список записанных дней перечитывается при смене месяца и после того,
   * как заметку создали. Наблюдателя за папкой здесь нет намеренно: пометки
   * меняются от наших же действий, а календарь занимает угол панели.
   */
  async function refresh(): Promise<void> {
    try {
      written = await dailyNotesOfMonth(monthKey(year, month));
    } catch {
      written = [];
    }
  }

  $effect(() => {
    // Зависимость от года и месяца: их смена — единственный повод спросить
    // ядро заново.
    void year;
    void month;
    void refresh();
  });

  function step(delta: number): void {
    const next = shiftMonth(year, month, delta);
    year = next.year;
    month = next.month;
  }

  function toToday(): void {
    year = Number(today.slice(0, 4));
    month = Number(today.slice(5, 7));
  }

  function has(cell: Cell): boolean {
    return cell.inMonth && written.includes(cell.day);
  }

  async function open(cell: Cell): Promise<void> {
    await openDaily(cell.date);
    // Заметки за этот день могло не быть — теперь она есть.
    await refresh();
  }

  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
</script>

<section class="calendar">
  <header class="head">
    <button class="nav" type="button" onclick={() => step(-1)} aria-label="Прошлый месяц">
      <Icon name="tree.chevron" />
    </button>
    <!-- Подпись месяца — кнопка: щелчок возвращает к текущему месяцу. Так
         не нужна отдельная кнопка «сегодня», а место в панели дорого. -->
    <button class="label" type="button" onclick={toToday} title="К текущему месяцу">
      {monthLabel(year, month)}
    </button>
    <button class="nav next" type="button" onclick={() => step(1)} aria-label="Следующий месяц">
      <Icon name="tree.chevron" />
    </button>
  </header>

  <div class="grid" role="grid" aria-label="Календарь заметок">
    <div class="week names" role="row">
      {#each DAYS as name (name)}
        <span class="name" role="columnheader">{name}</span>
      {/each}
    </div>

    {#each weeks as week (week[0]?.date)}
      <div class="week" role="row">
        {#each week as cell (cell.date)}
          <button
            class="day"
            class:outside={!cell.inMonth}
            class:written={has(cell)}
            class:today={cell.date === today}
            type="button"
            role="gridcell"
            title={has(cell) ? `Заметка за ${cell.date}` : `Создать заметку за ${cell.date}`}
            onclick={() => void open(cell)}
          >
            {cell.day}
          </button>
        {/each}
      </div>
    {/each}
  </div>
</section>

<style>
  .calendar {
    flex: none;
    padding-bottom: var(--zn-space-2);
    border-bottom: var(--zn-border-width) solid var(--zn-color-border-subtle);
  }

  .head {
    display: flex;
    align-items: center;
    height: var(--zn-control-row-height);
    padding-inline: var(--zn-space-2);
  }

  .label {
    flex: 1;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--zn-color-fg-default);
    font: inherit;
    font-weight: var(--zn-font-weight-medium);
    text-align: center;
    cursor: pointer;
  }

  .nav {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--zn-control-row-height);
    height: var(--zn-control-row-height);
    padding: 0;
    border: none;
    border-radius: var(--zn-radius-sm);
    background: transparent;
    color: var(--zn-color-fg-muted);
    cursor: pointer;
    /* Уголок дерева смотрит вправо: назад — тот же значок, повёрнутый.
       Второго рисунка ради этого заводить не надо (тот же приём, что
       у раскрытой папки). */
    transform: rotate(180deg);
  }

  .nav.next {
    transform: none;
  }

  .nav:hover {
    background-color: var(--zn-color-bg-hover);
    color: var(--zn-color-fg-default);
  }

  .week {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    padding-inline: var(--zn-space-2);
  }

  .name {
    padding-block: var(--zn-space-1);
    color: var(--zn-color-fg-subtle);
    font-size: var(--zn-font-size-ui-small);
    text-align: center;
  }

  .day {
    padding: var(--zn-space-1) 0;
    border: none;
    border-radius: var(--zn-radius-sm);
    background: transparent;
    color: var(--zn-color-fg-default);
    font: inherit;
    font-size: var(--zn-font-size-ui-small);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .day:hover {
    background-color: var(--zn-color-bg-hover);
  }

  /* Дни соседних месяцев тише: они здесь ради целых недель, а не ради себя. */
  .outside {
    color: var(--zn-color-fg-subtle);
  }

  /* День с заметкой — акцентом и весом, а не точкой снизу: точка при кегле
     в одиннадцать пунктов сливается с числом соседней строки. */
  .written {
    color: var(--zn-color-accent);
    font-weight: var(--zn-font-weight-strong);
  }

  /* Сегодня — обводка: заливка спорила бы с пометкой «есть заметка»,
     а эти два признака бывают вместе. */
  .today {
    box-shadow: inset 0 0 0 var(--zn-border-width) var(--zn-color-border-default);
  }
</style>
