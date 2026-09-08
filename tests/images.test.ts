import { describe, expect, it } from 'vitest';
import { embedIsImage, localTarget } from '../src/editor/images';
import { wikilinkSpans } from '../src/editor/wikilinks';

/**
 * Что из адреса картинки в markdown можно показать.
 *
 * Правила тут не про рисование, а про разбор чужого текста, и ошибиться
 * в них легко: буква диска Windows выглядит как схема адреса, пробелы
 * записаны процентами, а имя файла бывает в угловых скобках.
 */
describe('адрес картинки', () => {
  it('обычный путь берётся как есть', () => {
    expect(localTarget('рисунок.png')).toBe('рисунок.png');
    expect(localTarget('снимки/экран.png')).toBe('снимки/экран.png');
    expect(localTarget('../общее/схема.png')).toBe('../общее/схема.png');
  });

  /**
   * Сетевой адрес не загружается никогда (Р-202): приложение открывает
   * соединение только по нажатию (Р-118), а открытая заметка — не нажатие.
   */
  it('сетевой адрес отвергается', () => {
    expect(localTarget('https://example.org/р.png')).toBeNull();
    expect(localTarget('http://example.org/р.png')).toBeNull();
    expect(localTarget('//example.org/р.png')).toBeNull();
  });

  /** `data:` и `file:` тоже адреса, а не пути: разбирать их мы не беремся. */
  it('прочие схемы отвергаются', () => {
    expect(localTarget('data:image/png;base64,AAAA')).toBeNull();
    expect(localTarget('file:///C:/р.png')).toBeNull();
  });

  /**
   * Одна буква с двоеточием — диск Windows, а не схема. Спутать легко,
   * и цена ошибки — «картинки по полному пути не показываются вовсе».
   */
  it('буква диска не считается схемой', () => {
    expect(localTarget('C:/снимки/экран.png')).toBe('C:/снимки/экран.png');
    expect(localTarget('D:\\общее\\схема.png')).toBe('D:\\общее\\схема.png');
  });

  it('угловые скобки снимаются', () => {
    expect(localTarget('<имя с пробелами.png>')).toBe('имя с пробелами.png');
  });

  it('проценты раскодируются', () => {
    expect(localTarget('имя%20с%20пробелами.png')).toBe('имя с пробелами.png');
    expect(localTarget('%D1%80%D0%B8%D1%81.png')).toBe('рис.png');
  });

  /**
   * Одинокий процент — не повод отказываться от картинки: берём как есть.
   *
   * Заодно видно и цену раскодирования: `%50` — это правильная запись буквы
   * `P`, и файл, названный так буквально, мы не найдём. Так устроен markdown:
   * адрес в нём записан процентами, и читать его иначе нельзя.
   */
  it('неразбираемые проценты не ломают путь', () => {
    expect(localTarget('скидка%.png')).toBe('скидка%.png');
    expect(localTarget('скидка%50.png')).toBe('скидкаP.png');
  });

  it('пустой адрес показывать нечем', () => {
    expect(localTarget('')).toBeNull();
    expect(localTarget('   ')).toBeNull();
    expect(localTarget('<>')).toBeNull();
  });
});

/**
 * Вставка Obsidian — `![[рисунок.png]]` (задача 83).
 *
 * Два правила, и оба решаются до всякого обращения к индексу: вставка это
 * или ссылка, и картинка ли то, что вставляют.
 */
describe('вставка файла', () => {
  it('восклицательный знак перед скобками делает ссылку вставкой', () => {
    const [link] = wikilinkSpans('текст [[Заметка]] дальше');
    expect(link?.embed).toBe(false);

    const [embed] = wikilinkSpans('текст ![[рисунок.png]] дальше');
    expect(embed?.embed).toBe(true);
  });

  /** Знак стоит вплотную: `! [[имя]]` — это восклицание и ссылка. */
  it('знак на расстоянии вставкой не делает', () => {
    const [span] = wikilinkSpans('ого! [[Заметка]]');
    expect(span?.embed).toBe(false);
  });

  it('картинка узнаётся по расширению', () => {
    expect(embedIsImage('рисунок.png')).toBe(true);
    expect(embedIsImage('СНИМОК.JPG')).toBe(true);
    expect(embedIsImage('вложения/схема.webp')).toBe(true);
  });

  /**
   * `![[заметка]]` в Obsidian вставляет её текст, а мы этого не умеем.
   * Такая запись остаётся исходником, а не превращается в жалобу
   * на несделанное.
   */
  it('всё остальное картинкой не считается', () => {
    expect(embedIsImage('заметка')).toBe(false);
    expect(embedIsImage('заметка.md')).toBe(false);
    expect(embedIsImage('устав.pdf')).toBe(false);
    expect(embedIsImage('файл.png.txt')).toBe(false);
  });
});
