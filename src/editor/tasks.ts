import { WidgetType, type EditorView } from '@codemirror/view';

import { icon } from '../icons/registry';

/**
 * Задачи `- [ ]` щелчком (задача 91).
 *
 * В превью на месте `[ ]` рисуется настоящий переключатель, и щелчок по нему
 * правит документ — один знак между скобками. Это **единственное место
 * превью, которое меняет текст**: всё остальное только показывает (Р-160).
 * Оговорки при этом те же, что у всякой нашей правки чужого файла:
 *
 * * правится ровно один знак, и только если на его месте и правда стоит
 *   `[ ]`, `[x]` или `[X]`. Проверка перед записью — то же правило, что
 *   у замены по проекту: испорченный текст хуже непереключённой задачи;
 * * **курсор от щелчка не двигается.** Иначе строка тут же стала бы
 *   исходником (Р-158), переключатель исчез бы из-под пальца, и это
 *   читалось бы как «щёлкнул, а он пропал».
 *
 * Знак задачи разбирает GFM: узел `TaskMarker` длиной ровно три знака
 * и только внутри элемента списка. Своего разбора здесь нет.
 */

/** Что стоит между скобками. `null` — это не знак задачи. */
export type TaskState = 'open' | 'done';

/** Разобрать знак задачи: `[ ]`, `[x]` или `[X]` — и ничего больше. */
export function taskState(marker: string): TaskState | null {
  if (marker.length !== 3 || marker[0] !== '[' || marker[2] !== ']') return null;

  const inside = marker[1];
  if (inside === ' ') return 'open';
  if (inside === 'x' || inside === 'X') return 'done';
  return null;
}

/**
 * Чем заменить знак между скобками при переключении.
 *
 * Сделанную задачу помечаем строчной `x` — так пишет Obsidian, так пишут
 * почти все. Заглавную `X`, если она уже стояла, при снятии мы не храним:
 * снятая задача — это пробел, и вариантов у него нет.
 */
export function toggleChar(state: TaskState): string {
  return state === 'done' ? ' ' : 'x';
}

/**
 * Переключатель задачи: квадрат с галочкой на месте `[ ]`.
 *
 * Рисуется значком из нашего реестра, а не `<input type="checkbox">`:
 * системный флажок не слушается токенов оформления — ни цвета, ни размера, —
 * и в тёмной теме выглядит чужой деталью. Тот же приём, что у значка
 * callout-а (задача 66).
 */
export class TaskBox extends WidgetType {
  constructor(readonly state: TaskState) {
    super();
  }

  /** Без этого узел пересоздаётся на каждой пересборке украшений. */
  override eq(other: TaskBox): boolean {
    return other.state === this.state;
  }

  override toDOM(view: EditorView): HTMLElement {
    const done = this.state === 'done';

    const box = document.createElement('span');
    box.className = done ? 'zn-task zn-task-done' : 'zn-task';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(done));
    box.title = done ? 'Снять отметку' : 'Отметить сделанным';
    // Разметка из собственного реестра значков, а не из файла пользователя.
    box.innerHTML = icon(done ? 'md.task-done' : 'md.task-open');

    // `mousedown`, а не `click`: курсор редактор ставит именно по нажатию,
    // и отменять надо его. К моменту `click` строка уже была бы исходником.
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleAt(view, box);
    });

    return box;
  }

  /**
   * Событие остаётся нам: редактор не должен ни двигать курсор, ни начинать
   * выделение по нажатию на переключатель.
   */
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Переключить задачу, чей переключатель нарисован этим узлом.
 *
 * Положение берётся у представления в момент нажатия, а не запоминается
 * при создании узла: между тем и другим документ мог измениться, и правка
 * по старому смещению попала бы в чужой текст.
 */
function toggleAt(view: EditorView, dom: HTMLElement): void {
  const at = view.posAtDOM(dom);
  const marker = view.state.doc.sliceString(at, at + 3);
  const state = taskState(marker);

  // На месте не знак задачи — не трогаем ничего. Так же ведёт себя замена
  // по проекту, когда план устарел.
  if (state === null) return;

  view.dispatch({
    changes: { from: at + 1, to: at + 2, insert: toggleChar(state) },
    // Выделение не трогаем вовсе: человек щёлкнул по переключателю,
    // а не по тексту, и место, где он писал, обязано остаться.
    scrollIntoView: false,
  });
}
