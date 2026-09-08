import { WidgetType } from '@codemirror/view';

import { previewImage, previewEmbed } from '../ipc/files';
import { IMAGE_EXTENSIONS } from '../actions/file-types';

/**
 * Картинки в живом превью markdown: `![подпись](рисунок.png)` показывается
 * самой картинкой.
 *
 * Байты берутся тем же путём, что и у вкладки с картинкой, — одной командой
 * ядра (Р-201): один предел на размер, один список видов, один способ отдать
 * данные. Делать этот путь дважды незачем, и об этом было сказано ещё
 * в плане этапа.
 *
 * **Сетевой адрес не загружается никогда** (Р-202). Приложение открывает
 * соединение только по нажатию (Р-118), а картинка в чужой заметке — это
 * не нажатие: открыв её, человек не просил ходить в сеть. Такая ссылка
 * остаётся исходником, и по нему сразу видно, почему картинки нет.
 */

/**
 * Что из адреса картинки можно показать.
 *
 * `null` — показывать нечего: адрес сетевой, пустой или записан схемой,
 * которую мы не открываем.
 *
 * Чистая функция и отдельно от виджета — ради проверки: правила здесь
 * не про рисование, а про разбор чужого текста, и ошибиться в них легко.
 */
export function localTarget(url: string): string | null {
  let text = url.trim();
  if (text === '') return null;

  // `![подпись](<имя с пробелами.png>)` — угловые скобки часть записи,
  // а не имени файла.
  if (text.startsWith('<') && text.endsWith('>')) {
    text = text.slice(1, -1).trim();
  }

  // Схема из двух и более букв — это адрес, а не путь: `http:`, `https:`,
  // `data:`, `file:`. Одна буква с двоеточием — диск Windows (`C:\…`),
  // и его-то как раз показывать надо.
  if (/^[a-z][a-z0-9+.-]+:/i.test(text)) return null;

  // Адрес без схемы, но с двумя косыми, — тоже сетевой.
  if (text.startsWith('//')) return null;

  // Пробелы и кириллица в markdown часто записаны процентами.
  try {
    text = decodeURIComponent(text);
  } catch {
    // Одинокий процент — не повод отказываться от картинки: берём как есть.
  }

  return text === '' ? null : text;
}

/**
 * Картинка ли это по имени — для `![[рисунок.png]]` (задача 83).
 *
 * Решается по расширению и **синхронно**: показывать вставку картинкой или
 * оставить исходником, надо решить в тот же миг, когда собираются украшения,
 * а ответ индекса приходит позже. Список расширений канонический — он лежит
 * в ядре и сверяется тестом (`tests/file-types.test.ts`).
 *
 * Вставку не-картинки мы не трогаем вовсе: `![[заметка]]` в Obsidian
 * вставляет её текст, а мы этого не умеем, и рисовать вместо неё «файла нет»
 * значило бы обещать несделанное.
 */
export function embedIsImage(target: string): boolean {
  const dot = target.lastIndexOf('.');
  if (dot < 0) return false;
  return (IMAGE_EXTENSIONS as readonly string[]).includes(
    target.slice(dot + 1).toLowerCase(),
  );
}

/**
 * Сколько байтов картинок держать в памяти окна.
 *
 * Предел общий, а не поштучный: заметка с десятком снимков экрана — обычное
 * дело, и «двенадцать картинок» ничего не говорят о занятой памяти, а
 * «двадцать четыре мегабайта» говорят. Р-193 у вкладки решает то же самое
 * жёстче — там байты живут, только пока вкладка на экране; здесь так нельзя:
 * картинка уезжает за край экрана и возвращается при каждой прокрутке.
 */
const CACHE_LIMIT = 24 * 1024 * 1024;

const cache = new Map<string, string>();
let cached = 0;

/** Почему картинка не показалась. Помним, чтобы не спрашивать снова и снова. */
const failed = new Map<string, string>();

function key(link: string, base: string | null): string {
  return `${base ?? ''}\u0000${link}`;
}

function remember(id: string, source: string): void {
  cache.set(id, source);
  cached += source.length;

  // Вытесняется самое давнее: `Map` хранит порядок добавления, и первый
  // ключ — тот, что лежит дольше всех.
  while (cached > CACHE_LIMIT && cache.size > 1) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cached -= cache.get(oldest.value)?.length ?? 0;
    cache.delete(oldest.value);
  }
}

/** Забыть всё: заметку закрыли или файлы на диске поменялись. */
export function forgetImages(): void {
  cache.clear();
  failed.clear();
  cached = 0;
}

/**
 * Картинка на месте разметки.
 *
 * Виджет, а не украшение текста: на экране должно появиться то, чего
 * в документе нет. Документ при этом не меняется ни на знак —
 * `Decoration.replace` подменяет показ (Р-160).
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly link: string,
    readonly base: string | null,
    readonly alt: string,
  ) {
    super();
  }

  /**
   * Без этого узел пересоздаётся на каждой пересборке украшений — то есть
   * на каждое движение курсора, — и картинка мигала бы при наборе.
   */
  override eq(other: ImageWidget): boolean {
    return other.link === this.link && other.base === this.base && other.alt === this.alt;
  }

  override toDOM(): HTMLElement {
    return paint(this.link, key(this.link, this.base), this.alt, () =>
      previewImage(this.link, this.base),
    );
  }

  /** Курсор ходит по разметке, а не по картинке: она не текст. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Картинка, вставленная записью Obsidian: `![[рисунок.png]]`.
 *
 * Отдельный виджет, а не флаг у `ImageWidget`: у них разные ключи кэша
 * (у одного путь и папка заметки, у другого имя и сама заметка) и разный
 * способ добыть байты. Общего у них ровно то, что оба показывают картинку,
 * и это общее вынесено в `paint`.
 */
export class EmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly from: string | null,
    readonly alt: string,
  ) {
    super();
  }

  override eq(other: EmbedWidget): boolean {
    return other.target === this.target && other.from === this.from;
  }

  override toDOM(): HTMLElement {
    return paint(this.target, key(this.target, this.from), this.alt, async () => {
      if (this.from === null) {
        throw new Error('заметка ещё не сохранена: ссылку не по чему разрешать');
      }
      return previewEmbed(this.target, this.from);
    });
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** Общая часть обоих виджетов: рамка, кэш, жалоба вместо пустого места. */
function paint(
  link: string,
  id: string,
  alt: string,
  load: () => Promise<string>,
): HTMLElement {
  const box = document.createElement('span');
  box.className = 'zn-image';

  const problem = failed.get(id);
  if (problem !== undefined) {
    box.append(missing(link, problem));
    return box;
  }

  const image = document.createElement('img');
  image.alt = alt;
  box.append(image);

  const ready = cache.get(id);
  if (ready !== undefined) {
    image.src = ready;
    return box;
  }

  void fillWith(box, image, link, id, load);
  return box;
}

async function fillWith(
  box: HTMLElement,
  image: HTMLImageElement,
  link: string,
  id: string,
  load: () => Promise<string>,
): Promise<void> {
  try {
    const source = await load();
    remember(id, source);
    image.src = source;
  } catch (error) {
    const problem = String(error);
    failed.set(id, problem);
    // Узел мог уехать с экрана, пока читали файл, — тогда его уже нет
    // в разметке, и трогать нечего.
    if (box.isConnected) {
      box.replaceChildren(missing(link, problem));
    }
  }
}

/**
 * Картинки нет — говорим об этом, а не оставляем пустое место (Р-194).
 *
 * Коротко и в строке: исходник со всей записью человек увидит, поставив
 * на строку курсор, — там же и поправит путь.
 */
function missing(link: string, problem: string): HTMLElement {
  const note = document.createElement('span');
  note.className = 'zn-image-missing';
  note.textContent = `картинки нет: ${link}`;
  note.title = problem;
  return note;
}
