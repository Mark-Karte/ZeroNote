/**
 * История мест курсора: «назад» и «вперёд» (задача 85).
 *
 * Идея пришла из работы, а не из плана: хождение по ссылкам между заметками
 * необратимо — вернуться можно, только вспомнив, откуда пришёл.
 *
 * **Место — это вкладка, область и позиция.** Область входит в место, потому
 * что один файл живёт в нескольких областях (Р-209), и «вернуться» значит
 * вернуться туда, где человек и правда был.
 *
 * Модуль ничего не знает ни про вкладки, ни про области: он держит два стека
 * и решает, когда делать запись. Всё остальное — крючки, и это не ради
 * красоты, а ради проверяемости: правила здесь легко нарушить не подумав,
 * а на живом окне такое ловится плохо.
 */

export interface Place {
  /** Номер буфера. */
  tab: number;
  /** Область, в которой человек был. */
  pane: number;
  /** Позиция курсора в символах от начала. */
  pos: number;
}

export interface HistoryHooks {
  /**
   * Где сейчас курсор этого места. `null` — места больше нет: вкладку
   * закрыли, область схлопнулась.
   */
  cursorOf: (place: Place) => number | null;
  /** Перейти в место: сделать область и вкладку активными, поставить курсор. */
  goTo: (place: Place) => void;
}

/**
 * Сколько строк должен перескочить курсор, чтобы это стало записью.
 *
 * Десять — столько же в VS Code. Смысл порога в том, чтобы отделить чтение
 * от прыжка: набор, стрелки и прокрутка колесом двигают курсор понемногу,
 * а переход к строке, закладка, оглавление и щелчок в другой конец файла —
 * сразу далеко.
 */
export const JUMP_LINES = 10;

/**
 * Сколько мест помнить.
 *
 * Пятьдесят — не техническое ограничение, а мера полезности: дальше человек
 * уже не помнит, куда возвращается, и жмёт «назад» вслепую.
 */
const LIMIT = 50;

/** Стеки в руне: от них зависят кнопки в шапке — гаснут, когда идти некуда. */
export const history = $state<{ back: Place[]; forward: Place[] }>({
  back: [],
  forward: [],
});

/**
 * Где мы сейчас, по мнению истории.
 *
 * Обычная переменная, а не руна: интерфейс от неё не зависит. Позиция здесь
 * может устареть — курсор в той вкладке живёт своей жизнью, — поэтому перед
 * записью место освежается через `cursorOf`.
 */
let here: Place | null = null;

let hooks: HistoryHooks = {
  cursorOf: () => null,
  goTo: () => {},
};

export function configureHistory(next: HistoryHooks): void {
  hooks = next;
}

/** Для тестов: забыть всё и начать с чистого. */
export function resetHistory(): void {
  history.back.length = 0;
  history.forward.length = 0;
  here = null;
}

export function canGoBack(): boolean {
  return history.back.length > 0;
}

export function canGoForward(): boolean {
  return history.forward.length > 0;
}

function samePlace(a: Place, b: Place): boolean {
  return a.tab === b.tab && a.pane === b.pane && a.pos === b.pos;
}

/** Место с сегодняшним курсором вместо запомненного. */
function fresh(place: Place): Place {
  const pos = hooks.cursorOf(place);
  return pos === null ? place : { ...place, pos };
}

/**
 * Положить место в «назад» и забыть «вперёд».
 *
 * Забыть — обязательно: после нового перехода прежний путь вперёд ведёт
 * туда, где человек уже не был. Так же ведёт себя браузер, и по той же
 * причине.
 */
function push(place: Place): void {
  const last = history.back[history.back.length - 1];
  if (last && samePlace(last, place)) return;

  history.back.push(place);
  if (history.back.length > LIMIT) history.back.shift();
  history.forward.length = 0;
}

/**
 * Сообщить, где мы теперь.
 *
 * Зовётся при смене активной вкладки или области. Запись делается только
 * при переходе между **разными** местами: перемещение курсора внутри той же
 * вкладки историей не считается — для него есть `jumped`, и порог у него
 * свой.
 */
export function arrivedAt(place: Place | null): void {
  if (place === null) {
    here = null;
    return;
  }

  if (here !== null && (here.tab !== place.tab || here.pane !== place.pane)) {
    push(fresh(here));
  }

  here = place;
}

/**
 * Курсор прыгнул далеко внутри одной вкладки.
 *
 * `from` — откуда прыгнул: именно оно и есть место, куда вернёт «назад».
 * Решение «далеко ли» принимает не этот модуль: у него нет документа,
 * а порог считается в строках.
 */
export function jumped(from: Place, to: Place): void {
  push(from);
  here = to;
}

/** Снять со стека ближайшее место, которое ещё существует. */
function pop(stack: Place[]): Place | null {
  while (stack.length > 0) {
    const place = stack.pop()!;
    // Закрытую вкладку пропускаем молча: «назад» не должно упираться
    // в пустоту и требовать второго нажатия за каждый закрытый файл.
    if (hooks.cursorOf(place) !== null) return place;
  }
  return null;
}

function step(from: Place[], to: Place[]): boolean {
  const target = pop(from);
  if (target === null) return false;

  if (here !== null) {
    const now = fresh(here);
    if (!samePlace(now, target)) to.push(now);
  }

  // `here` меняется до перехода, а не после: о смене активной вкладки нам
  // сообщат тем же `arrivedAt`, и без этого переход по истории сам оставил бы
  // в ней запись — «назад» стало бы возвращать на место, откуда только что
  // ушли, то есть никуда.
  here = target;
  hooks.goTo(target);
  return true;
}

export function goBack(): boolean {
  return step(history.back, history.forward);
}

export function goForward(): boolean {
  return step(history.forward, history.back);
}
