import { styleTags, tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';

/**
 * Frontmatter — узел разбора markdown (задача 114).
 *
 * До задачи 114 разбора frontmatter у редактора не было, и CommonMark
 * читал его по-своему: первая `---` — черта, `tags: …` над следующей
 * `---` — подчёркнутый заголовок. Превью так его и рисовало. Вывод HTML
 * отрезал его своей строкой, оглавление пропускало своим разбором, и два
 * правила расходились: у одного незакрытая ограда была чертой, у другого —
 * frontmatter до конца файла.
 *
 * Теперь правило одно и живёт здесь: узел `Frontmatter` видят все, кто
 * смотрит в дерево, — подсветка, превью, вывод HTML, — а оглавление, которое
 * в дерево не смотрит (оно ленивое, Р-139), зовёт `frontmatterLines`
 * с теми же двумя проверками. Что они не разошлись, сверяет тест.
 *
 * Правило (Р-274):
 *
 * * открывает только **первая строка файла**, ровно `---`;
 * * закрывает первая следующая строка из трёх и больше дефисов, пробелы
 *   в конце можно — как в ядре (`markdown/front.rs`);
 * * **незакрытый frontmatter тянется до конца файла** — как незакрытый
 *   блок кода в CommonMark. Иначе нельзя: чтобы назвать первую строку
 *   чертой, разбору пришлось бы заглянуть до конца файла, а дерево
 *   строится по частям, и часть над правкой он не перечитывает. Дописал
 *   закрывающую `---` — и frontmatter не появился бы до переоткрытия файла
 *   (проверено опытом, раздел 42). Ядро здесь другое: для индекса
 *   незакрытая ограда — черта, и теги с ссылками из такой заметки
 *   находятся — лишнее найденное лучше потерянного.
 *
 * Показ — приглушённым исходником: содержимое не толкуется и не меняется
 * никогда (Р-068, инвариант 1). Карточка «Свойства», как в Obsidian, —
 * часть вида по снимкам владельца, не этого узла.
 */

/** Строка открывает frontmatter — если это первая строка файла. */
export function opensFrontmatter(line: string): boolean {
  return line === '---' || line === '---\r';
}

/** Строка закрывает frontmatter: три и больше дефисов, пробелы в конце можно. */
export function closesFrontmatter(line: string): boolean {
  return /^-{3,}[ \t]*\r?$/.test(line);
}

/**
 * Сколько первых строк документа занимает frontmatter; 0 — его нет.
 *
 * Строки — без знаков переноса, по порядку с первой. Незакрытый
 * frontmatter занимает все строки.
 */
export function frontmatterLines(lines: Iterable<string>): number {
  let count = 0;
  for (const line of lines) {
    count += 1;
    if (count === 1) {
      if (!opensFrontmatter(line)) return 0;
    } else if (closesFrontmatter(line)) {
      return count;
    }
  }
  return count;
}

/**
 * Расширение разбора: блок `Frontmatter` в начале документа.
 *
 * Лист, а не составной блок: внутри не разбирается ничего — `- пункт`
 * там строка YAML, а не список, и `# комментарий` — не заголовок.
 * Стоит перед чертой: иначе первую `---` забрала бы она.
 */
export const frontmatter: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true }],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        // Только самая первая строка документа. Внутри цитаты или списка
        // строка начинается со своего знака, и `---` не совпадёт.
        if (cx.lineStart !== 0 || !opensFrontmatter(line.text)) return false;

        const from = cx.lineStart;
        let to = from + line.text.length;
        while (cx.nextLine()) {
          to = cx.lineStart + line.text.length;
          if (closesFrontmatter(line.text)) {
            // Закрывающая строка — наша: разбор продолжится со следующей.
            cx.nextLine();
            break;
          }
        }

        cx.addElement(cx.elt('Frontmatter', from, to));
        return true;
      },
    },
  ],
  props: [
    styleTags({
      // Приглушённо, как знаки разметки: это служебные поля файла, а не текст.
      Frontmatter: tags.processingInstruction,
    }),
  ],
};
