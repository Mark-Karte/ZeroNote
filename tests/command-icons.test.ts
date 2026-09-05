import { describe, expect, it } from 'vitest';
import { commandsWithIcons, iconForCommand } from '../src/icons/commands';
import { iconNames, type IconName } from '../src/icons/registry';
import { MENU } from '../src/ui/menus';

/**
 * Значок есть у каждой команды (Р-148).
 *
 * Меню, где значки у половины пунктов, выглядит недоделанным — и это ровно
 * то, что видно глазами и не видно ни одному тесту. Поэтому проверка тут
 * не про рисунок, а про полноту: добавили команду — таблица напомнит о себе
 * до того, как пустая строка появится в меню у тестировщика.
 *
 * Список команд берётся из реестра фронтенда, а он, в свою очередь, сверяется
 * с каноническим списком в Rust (`tests/keymap.test.ts`). Значит, цепочка
 * замкнута: команда, добавленная в ядро, доходит до значка.
 */

/**
 * Реестр команд тянет за собой половину приложения — CodeMirror, состояние,
 * вызовы Tauri. Для проверки полноты нужен только список имён, поэтому он
 * читается из исходника, а не импортируется.
 */
async function commandIds(): Promise<string[]> {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile('src/keymap/registry.ts', 'utf8');

  const body = source.slice(
    source.indexOf('export const COMMANDS'),
    source.indexOf('export function commandIds'),
  );

  return [...body.matchAll(/^ {2}'([a-z]+\.[a-z0-9-]+)':/gm)].map((match) => match[1]!);
}

describe('значки команд', () => {
  it('реестр команд читается', async () => {
    const ids = await commandIds();
    expect(ids.length).toBeGreaterThan(60);
    expect(ids).toContain('file.save');
    expect(ids).toContain('md.divider');
  });

  it('есть у каждой команды', async () => {
    const missing = (await commandIds()).filter((id) => iconForCommand(id) === null);
    expect(missing, 'команды без значка').toEqual([]);
  });

  it('есть у каждого пункта меню, у которого нет команды', () => {
    const missing = Object.values(MENU).filter((id) => iconForCommand(id) === null);
    expect(missing, 'пункты меню без значка').toEqual([]);
  });

  /**
   * Обратная сторона: таблица не должна обрастать строками для команд,
   * которых больше нет. Такая строка ничего не ломает — и потому живёт
   * годами, а вместе с ней и рисунок, который никто не видит.
   */
  it('не содержит команд, которых нет', async () => {
    const known = new Set([...(await commandIds()), ...Object.values(MENU)]);
    const stale = commandsWithIcons().filter((id) => !known.has(id));
    expect(stale, 'значки для несуществующих команд').toEqual([]);
  });

  it('ссылается только на зарегистрированные значки', () => {
    const registered = new Set<IconName>(iconNames());
    const broken = commandsWithIcons().filter(
      (id) => !registered.has(iconForCommand(id) as IconName),
    );
    expect(broken).toEqual([]);
  });

  /**
   * Один рисунок на несколько команд — норма (поиск в файле и поиск
   * в проекте), но там, где разница есть на деле, значки обязаны различаться.
   * Пары ниже стоят в одном меню друг под другом: одинаковый значок у них
   * означал бы, что меню показывает два одинаковых пункта.
   */
  it('противоположные действия различаются значком', () => {
    const pairs: [string, string][] = [
      ['edit.undo', 'edit.redo'],
      ['view.fold', 'view.unfold'],
      ['view.fold-all', 'view.unfold-all'],
      ['view.bookmark-next', 'view.bookmark-previous'],
      ['search.find-next', 'search.find-previous'],
      ['view.next-tab', 'view.previous-tab'],
      ['edit.move-line-up', 'edit.move-line-down'],
      ['edit.upper-case', 'edit.lower-case'],
      ['file.close-tab', 'file.close-all'],
    ];

    for (const [first, second] of pairs) {
      expect(iconForCommand(first), `${first} и ${second}`).not.toBe(iconForCommand(second));
    }
  });
});
