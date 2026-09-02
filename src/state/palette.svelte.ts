import * as ipc from '../ipc/index';
import type { FileHit, TagHit } from '../ipc/index';
import { openPath } from './tabs.svelte';
import { parse, matches, withMode, type PaletteMode } from '../ui/palette/query';
import { COMMANDS } from '../keymap/registry';
import { commandList } from '../keymap/global';
import { showPanel } from './roots.svelte';
import { searchByTag } from './project-search.svelte';

/**
 * Палитра: одно поле с режимами по префиксу (Р-076).
 *
 * Пустой запрос ищет файлы, `>` — команды, `#` — теги. Разбор строки живёт
 * в `ui/palette/query.ts` и проверяется тестом; здесь — что делать с разбором.
 *
 * Файлы спрашиваются у ядра на каждое нажатие, без задержки: нечёткое
 * совпадение по десяти тысячам имён стоит доли миллисекунды, а задержка
 * в палитре ощущается сразу. Теги — тоже запрос к ядру, но их мало и запрос
 * дешевле. Команды не спрашиваются вовсе: список уже здесь.
 */

/** Строка списка. Вид разный, поведение при выборе — тоже. */
export type Item =
  | { kind: 'file'; hit: FileHit }
  | { kind: 'command'; id: string; title: string; binding: string | null }
  | { kind: 'tag'; tag: string; count: number };

export const palette = $state<{
  open: boolean;
  query: string;
  items: Item[];
  selected: number;
}>({
  open: false,
  query: '',
  items: [],
  selected: 0,
});

/** Режим, выведенный из строки. Читается интерфейсом для подписи поля. */
export function mode(): PaletteMode {
  return parse(palette.query).mode;
}

/** Номер последнего запроса: ответы могут прийти не в том порядке, в каком ушли. */
let latest = 0;

export async function refresh(): Promise<void> {
  const { mode: kind, term } = parse(palette.query);
  const mine = ++latest;

  if (kind === 'commands') {
    // Синхронно: список команд уже в памяти, и гонять его через IPC незачем.
    palette.items = commandList()
      .filter((command) => matches(command.title, term))
      .map((command) => ({ kind: 'command' as const, ...command }));
    palette.selected = 0;
    return;
  }

  const items: Item[] =
    kind === 'tags'
      ? (await ipc.findTags(term, 50)).map((hit: TagHit) => ({
          kind: 'tag' as const,
          tag: hit.tag,
          count: hit.count,
        }))
      : (await ipc.findFiles(term, 50)).map((hit) => ({ kind: 'file' as const, hit }));

  // Ответ на устаревший запрос выбрасываем: иначе в списке окажется выдача
  // для того, что пользователь уже дописал, или выдача чужого режима.
  if (mine !== latest) return;

  palette.items = items;
  palette.selected = 0;
}

/**
 * Открыть палитру в нужном режиме.
 *
 * Режим задаётся точкой входа, а не остаётся от прошлого раза: Ctrl+P обязан
 * показать файлы, даже если в прошлый раз в палитре искали команду. Иначе
 * привычное сочетание приводило бы то туда, то сюда.
 *
 * Набранное при этом сохраняется — повторное открытие обычно означает
 * «то же самое, но я промахнулся мимо строки».
 */
export function open(kind: PaletteMode = 'files'): void {
  palette.open = true;
  palette.query = withMode(palette.query, kind);
  void refresh();
}

export function close(): void {
  palette.open = false;
}

export function move(delta: number): void {
  if (palette.items.length === 0) return;
  const count = palette.items.length;
  // По кругу: список короткий, и упираться в край неприятно.
  palette.selected = (palette.selected + delta + count) % count;
}

export async function accept(): Promise<void> {
  const item = palette.items[palette.selected];
  if (!item) return;

  close();

  switch (item.kind) {
    case 'file':
      await openPath(item.hit.path);
      return;
    case 'command': {
      const run = COMMANDS[item.id];
      // Команд без обработчика в списке не бывает — `commandList` их отсеивает.
      // Проверка на случай, если отсеивать перестанут.
      if (run) await run();
      return;
    }
    case 'tag':
      // Выбранный тег уезжает в панель поиска, а не разворачивается списком
      // прямо здесь: файлов с тегом бывает много, а панель умеет их листать,
      // помнить и показывать рядом с открытым файлом.
      showPanel('search');
      await searchByTag(item.tag);
      return;
  }
}
