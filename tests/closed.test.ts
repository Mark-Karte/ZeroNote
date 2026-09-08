import { beforeEach, describe, expect, it } from 'vitest';
import {
  closed,
  hasClosed,
  remember,
  resetClosed,
  takeClosed,
  type ClosedTab,
} from '../src/state/closed.svelte';

/**
 * Закрытые вкладки — `Ctrl+Shift+T` (задача 86).
 *
 * Стек короткий, но три правила в нём неочевидны: повтор заменяет запись,
 * уже открытый файл пропускается, а закрытая копия вкладки без файла
 * не попадает сюда вовсе — последнее решается выше, при записи.
 */

function tab(path: string, index = 0): ClosedTab {
  return {
    path,
    pane: 1,
    index,
    cursor: 0,
    scrollTop: 0,
    language: null,
    bookmarks: [],
  };
}

/** Ничего не открыто: обычный случай. */
const nothingOpen = () => false;

beforeEach(() => {
  resetClosed();
});

describe('стек закрытых', () => {
  it('возвращает последнюю закрытую', () => {
    remember(tab(String.raw`C:\п\первый.md`));
    remember(tab(String.raw`C:\п\второй.md`));

    expect(takeClosed(nothingOpen)?.path).toBe(String.raw`C:\п\второй.md`);
    expect(takeClosed(nothingOpen)?.path).toBe(String.raw`C:\п\первый.md`);
    expect(takeClosed(nothingOpen)).toBeNull();
  });

  it('пустой стек говорит об этом, а не притворяется', () => {
    expect(hasClosed()).toBe(false);
    expect(takeClosed(nothingOpen)).toBeNull();
  });

  /**
   * Иначе два нажатия подряд открыли бы один и тот же файл, а на второй раз
   * не случилось бы ничего.
   */
  it('повторное закрытие того же файла заменяет запись', () => {
    remember(tab(String.raw`C:\п\заметка.md`, 0));
    remember(tab(String.raw`C:\п\другая.md`));
    remember(tab(String.raw`C:\п\заметка.md`, 3));

    expect(closed.items).toHaveLength(2);
    // Свежая запись — с новым местом в полосе.
    expect(takeClosed(nothingOpen)).toMatchObject({ path: String.raw`C:\п\заметка.md`, index: 3 });
  });

  /** Windows не различает регистр путей, и обратная косая равна прямой. */
  it('путь сравнивается так же, как в ядре', () => {
    remember(tab(String.raw`C:\п\Заметка.md`));
    remember(tab('C:/п/заметка.md'));

    expect(closed.items).toHaveLength(1);
  });

  /**
   * Человек закрыл файл, потом открыл его сам — возвращать нечего.
   * Такие записи пропускаются молча: нажатие должно что-то делать.
   */
  it('уже открытый файл пропускается', () => {
    remember(tab(String.raw`C:\п\первый.md`));
    remember(tab(String.raw`C:\п\второй.md`));

    const open = (path: string) => path.endsWith('второй.md');

    expect(takeClosed(open)?.path).toBe(String.raw`C:\п\первый.md`);
    expect(hasClosed()).toBe(false);
  });

  it('помнит не больше двадцати', () => {
    for (let i = 0; i < 25; i += 1) {
      remember(tab(String.raw`C:\п\файл-${i}.md`));
    }

    expect(closed.items).toHaveLength(20);
    // Вытесняется самое давнее, а не самое свежее.
    expect(closed.items[0]?.path).toBe(String.raw`C:\п\файл-5.md`);
  });
});
