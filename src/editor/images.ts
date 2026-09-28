import { WidgetType } from '@codemirror/view';

import { previewImage, previewEmbed } from '../ipc/files';
import { IMAGE_EXTENSIONS } from '../actions/file-types';
import { t } from '../l10n';

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
const NETWORK = /^[\\/]{2}/;

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

  // Две косые в начале, любые, — сетевой адрес или сетевой путь
  // `\\сервер\папка` (задача 139). Путь тоже нельзя: читая его, Windows
  // сама входит на сервер и отдаёт ему хэш пароля, без всякого нажатия.
  if (NETWORK.test(text)) return null;

  // Пробелы и кириллица в markdown часто записаны процентами.
  try {
    text = decodeURIComponent(text);
  } catch {
    // Одинокий процент — не повод отказываться от картинки: берём как есть.
  }

  // И после раскодирования: `%5C%5Cсервер` — те же две косые.
  if (NETWORK.test(text)) return null;

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

/**
 * Почему картинка не показалась. Помним, чтобы не спрашивать снова и снова, —
 * до `forgetImages`: картинки могло не быть, пока индекс строился, или её
 * положили в папку позже (Р3 ревизии).
 */
const failed = new Map<string, string>();

export function imageKey(link: string, base: string | null): string {
  return `${base ?? ''}\u0000${link}`;
}

/**
 * Запомнить байты картинки.
 *
 * Прежнее значение того же ключа вычитается из счёта (Р3 ревизии): одна
 * картинка дважды на экране грузится двумя виджетами разом, и без этого
 * её длина прибавлялась дважды, а вычиталась при вытеснении один раз —
 * счёт рос без предела, и кэш вырождался до одной картинки.
 */
export function remember(id: string, source: string): void {
  const previous = cache.get(id);
  if (previous !== undefined) {
    cached -= previous.length;
    cache.delete(id);
  }
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

/** Сколько байтов картинок сейчас помнит окно. */
export function cachedBytes(): number {
  return cached;
}

/** Картинка не показалась — запомнить почему. */
export function rememberFailure(id: string, problem: string): void {
  failed.set(id, problem);
}

/**
 * Забыть всё: файлы на диске поменялись или индекс закончил проход (Р3
 * ревизии). Зовётся на событие слежения и на конец индексации — там же,
 * где забываются ответы про вики-ссылки. Картинка, которой не было,
 * пробуется снова, а заменённая на диске читается заново.
 */
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
export class ImageWidget extends WidgetType implements Shown {
  /**
   * Картинка не показалась — входит в сравнение (Р3 ревизии). Ставится
   * при сборке, если ошибка уже запомнена, и самой загрузкой, когда она
   * падает у виджета на экране: ошибка случается позже сборки, и признак,
   * снятый только при ней, оставлял упавший виджет «здоровым» — найдено
   * живой проверкой. После `forgetImages` новый виджет уже не «в ошибке»,
   * не равен упавшему, и узел пересоздаётся и пробует снова; здоровые
   * картинки остаются на месте и не мигают.
   */
  failing: boolean;

  constructor(
    readonly link: string,
    readonly base: string | null,
    readonly alt: string,
  ) {
    super();
    this.failing = failed.has(imageKey(link, base));
  }

  /**
   * Без этого узел пересоздаётся на каждой пересборке украшений — то есть
   * на каждое движение курсора, — и картинка мигала бы при наборе.
   */
  override eq(other: ImageWidget): boolean {
    return (
      other.link === this.link &&
      other.base === this.base &&
      other.alt === this.alt &&
      other.failing === this.failing
    );
  }

  override toDOM(): HTMLElement {
    return paint(this, this.link, imageKey(this.link, this.base), this.alt, () =>
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
export class EmbedWidget extends WidgetType implements Shown {
  /** Как у `ImageWidget`: после сброса кэша ошибочная вставка пробует снова. */
  failing: boolean;

  constructor(
    readonly target: string,
    readonly from: string | null,
    readonly alt: string,
  ) {
    super();
    this.failing = failed.has(imageKey(target, from));
  }

  override eq(other: EmbedWidget): boolean {
    return other.target === this.target && other.from === this.from && other.failing === this.failing;
  }

  override toDOM(): HTMLElement {
    return paint(this, this.target, imageKey(this.target, this.from), this.alt, async () => {
      if (this.from === null) {
        throw new Error(t('image.unsaved'));
      }
      return previewEmbed(this.target, this.from);
    });
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** Что знает виджет о своём показе: не показалась ли картинка. */
interface Shown {
  failing: boolean;
}

/** Общая часть обоих виджетов: рамка, кэш, жалоба вместо пустого места. */
function paint(
  shown: Shown,
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

  void fillWith(shown, box, image, link, id, load);
  return box;
}

async function fillWith(
  shown: Shown,
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
    rememberFailure(id, problem);
    shown.failing = true;
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
  note.textContent = t('image.missing', { link });
  note.title = problem;
  return note;
}
