import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { insertionFor, linkContextAt } from '../src/editor/suggest';
import { placeAtCaret } from '../src/ui/menu-position';

/**
 * Подсказка имён при `[[` (Р-132).
 *
 * Проверяется разбор текста вокруг курсора и составление вставки — то, что
 * ошибается молча. Список приходит из индекса и проверен в ядре
 * (`tests/graph.rs`), а вид списка — глазами.
 */

function at(doc: string, cursor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: cursor } });
}

/**
 * Курсор ставится на место знака `‸`, а сам знак из текста убирается.
 *
 * Знак редкий намеренно: привычная для таких помощников вертикальная черта
 * встречается в самих ссылках — `[[Планы|подпись]]`, — и первый же тест про
 * подпись разобрался бы не так, как выглядит.
 */
function caret(text: string): EditorState {
  const cursor = text.indexOf('‸');
  return at(text.replace('‸', ''), cursor);
}

describe('где набирается ссылка', () => {
  it('видит запрос сразу после двух скобок', () => {
    const context = linkContextAt(caret('Смотри [[Пла‸'));

    expect(context).not.toBeNull();
    expect(context!.query).toBe('Пла');
    expect(context!.from).toBe('Смотри [['.length);
  });

  /**
   * Пустой запрос — это тоже запрос: два знака набраны, и список должен
   * появиться до первой буквы. Иначе имя пришлось бы вспоминать наизусть,
   * ради чего подсказка и делается.
   */
  it('открывается на пустом запросе', () => {
    const context = linkContextAt(caret('Смотри [[‸'));

    expect(context?.query).toBe('');
  });

  /** Автозакрытие скобок вставляет `]]` само — это надо заметить. */
  it('отличает уже закрытую ссылку', () => {
    expect(linkContextAt(caret('Смотри [[‸]]'))?.closed).toBe(true);
    expect(linkContextAt(caret('Смотри [[‸'))?.closed).toBe(false);
  });

  it('молчит там, где скобок нет', () => {
    expect(linkContextAt(caret('Обычный текст‸'))).toBeNull();
  });

  /** Ссылка кончилась — дальше набирается обычный текст. */
  it('молчит после закрытой ссылки', () => {
    expect(linkContextAt(caret('Смотри [[Планы]] и ещё‸'))).toBeNull();
  });

  /**
   * Раздел и подпись — не имена файлов. Подсказывать в них имена заметок
   * значило бы предлагать не то, что человек набирает.
   */
  it('молчит после решётки и вертикальной черты', () => {
    expect(linkContextAt(caret('[[Планы#Зад‸'))).toBeNull();
    expect(linkContextAt(caret('[[Планы|подп‸'))).toBeNull();
  });

  /** Ссылка не переносится: разбор в `wikilinks.ts` тоже не пускает перевод. */
  it('не заглядывает на строку выше', () => {
    expect(linkContextAt(caret('Смотри [[\nПла‸'))).toBeNull();
  });

  /** Вставка `![[...]]` — та же ссылка, и подсказка ей нужна не меньше. */
  it('работает и во вставке', () => {
    expect(linkContextAt(caret('![[Пла‸'))?.query).toBe('Пла');
  });

  /**
   * Вторые скобки перебивают первые: набирается последняя ссылка, а не та,
   * что осталась незакрытой выше по строке.
   */
  it('берёт последние скобки', () => {
    const context = linkContextAt(caret('[[Первая [[Втор‸'));

    expect(context?.query).toBe('Втор');
  });

  /**
   * Осмотр ограничен двумя сотнями знаков перед курсором, и это не мелочь:
   * файл в одну строку на мегабайты открывают именно в таком редакторе,
   * и разбор строки целиком копировал бы её на каждое нажатие (инвариант 6).
   *
   * Видимое следствие — имя длиннее осмотра подсказки не получает. Заметок
   * с такими именами не бывает, а незаметная задержка ввода бывает.
   */
  it('дальше двухсот знаков не смотрит', () => {
    const near = linkContextAt(caret(`[[${'а'.repeat(150)}‸`));
    expect(near?.query).toHaveLength(150);

    const far = linkContextAt(caret(`[[${'а'.repeat(300)}‸`));
    expect(far).toBeNull();

    // И сам мегабайт перед ссылкой на разбор не влияет.
    const huge = linkContextAt(caret(`${'x'.repeat(200_000)} [[Пла‸`));
    expect(huge?.query).toBe('Пла');
  });

  it('молчит при выделении и при нескольких курсорах', () => {
    const selected = EditorState.create({
      doc: 'Смотри [[Планы',
      selection: { anchor: 9, head: 14 },
    });
    expect(linkContextAt(selected)).toBeNull();

    const many = EditorState.create({
      doc: '[[а\n[[б',
      selection: EditorSelection.create([
        EditorSelection.cursor(3),
        EditorSelection.cursor(7),
      ]),
      extensions: EditorState.allowMultipleSelections.of(true),
    });
    expect(linkContextAt(many)).toBeNull();
  });
});

describe('что вставляется', () => {
  it('дописывает закрывающие скобки, если их нет', () => {
    const context = linkContextAt(caret('Смотри [[Пла‸'))!;
    const edit = insertionFor(context, 'Планы');

    expect(edit.insert).toBe('Планы]]');
    expect(edit.from).toBe(9);
    expect(edit.to).toBe(12);
  });

  /**
   * Главная ошибка, которую тут можно сделать: дописать вторую пару скобок
   * поверх той, что вставило автозакрытие, и оставить `]]]]` посреди текста.
   */
  it('не удваивает уже стоящие скобки', () => {
    const context = linkContextAt(caret('Смотри [[Пла‸]]'))!;
    const edit = insertionFor(context, 'Планы');

    expect(edit.insert).toBe('Планы');
  });

  /** Курсор встаёт за ссылку — печатать дальше, а не внутри неё. */
  it('ставит курсор за закрывающими скобками', () => {
    const context = linkContextAt(caret('Смотри [[Пла‸]]'))!;
    const edit = insertionFor(context, 'Планы');

    // 9 — начало имени, 5 букв, две скобки.
    expect(edit.cursor).toBe(9 + 5 + 2);
  });

  /** Текст ссылки приходит из ядра и бывает путём — вставка та же. */
  it('вставляет путь так же, как имя', () => {
    const context = linkContextAt(caret('[[Пла‸'))!;

    expect(insertionFor(context, 'личное/Планы').insert).toBe('личное/Планы]]');
  });
});

describe('где встаёт список', () => {
  const size = { width: 300, height: 200 };
  const screen = { width: 1000, height: 800 };

  it('обычно под строкой с курсором', () => {
    const placed = placeAtCaret({ left: 100, top: 380, bottom: 400 }, size, screen, 8);

    expect(placed).toEqual({ left: 100, top: 400 });
  });

  /**
   * У нижнего края — над строкой, а не поверх неё. Список, накрывший
   * собственную строку, прячет ровно то, что подсказывает.
   */
  it('у нижнего края переворачивается над строкой', () => {
    const placed = placeAtCaret({ left: 100, top: 700, bottom: 720 }, size, screen, 8);

    expect(placed.top).toBe(500);
  });

  it('у правого края прижимается к нему', () => {
    const placed = placeAtCaret({ left: 900, top: 100, bottom: 120 }, size, screen, 8);

    expect(placed.left).toBe(1000 - 8 - 300);
  });

  /** Не помещается ни так, ни так — прижимаем к началу, остаток прокрутится. */
  it('в тесном окне прижимается к краю', () => {
    const placed = placeAtCaret(
      { left: 100, top: 100, bottom: 120 },
      { width: 400, height: 700 },
      { width: 400, height: 300 },
      8,
    );

    expect(placed.top).toBe(8);
    expect(placed.left).toBe(8);
  });
});
