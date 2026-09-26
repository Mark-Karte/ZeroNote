import temmlCss from 'temml/dist/Temml-Local.css?raw';

/**
 * Стиль формул — таблица Temml без его шрифта (приёмка этапа 17, Р-280).
 *
 * Без таблицы Chromium не выравнивает столбцы `aligned` (раздел 42),
 * а вот шрифт из неё мы не берём. `Temml.woff2` — клон KaTeX_Script,
 * собранный домашней редакцией FontCreator, и в самом файле записано:
 * «You may not use this font for commercial purposes». Проект под MIT,
 * а шрифт уходил бы и в установщик, и строкой `data:` в каждый
 * экспортированный файл с формулами — к чужим людям.
 *
 * Шрифт Temml нужен был двум вещам. Буквам `\mathscr` — без него они
 * рисуются начертанием Cambria Math, тем же, что `\mathcal`. И штриху
 * производной в Chromium: штрих Cambria Math уже стоит высоко, а движок
 * поднимает его ещё раз как верхний индекс и уменьшает — `f′` выходил
 * мелкой запятой над буквой. Это правится стилем: штрих того же размера,
 * что буква, и опущенный на высоту индекса. Проверено снимком безголового
 * Edge рядом со шрифтом Temml — на глаз не отличить.
 *
 * Одна строка на окно (`math-render.ts` ставит её в документ) и на файл
 * экспорта (`export/html.ts` кладёт её внутрь): вид формул не расходится.
 * Текстом, а не импортом CSS: сборка иначе увидела бы `url(Temml.woff2)`
 * и положила бы шрифт в кусок сама.
 */

/** Правка штриха — только для Chromium и WebKit: Firefox ставит его сам. */
const PRIME = `
@supports (not (-moz-appearance: none)) {
  mo.tml-prime {
    math-depth: 0;
    position: relative;
    top: 0.3em;
  }
}`;

/** Таблица Temml без шрифта: без `@font-face` и без правил, где он назначен. */
export function withoutTemmlFont(css: string): string {
  return (
    css
      // Комментарии — первыми: в заголовке таблицы говорится о шрифте,
      // которого в ней больше нет.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@font-face\s*\{[^}]*\}/g, '')
      // Правило, всё содержимое которого — назначение шрифта Temml.
      .replace(/[^{}]*\{\s*font-family:\s*["']?Temml["']?;?\s*\}/g, '')
  );
}

export function mathStyles(): string {
  return `${withoutTemmlFont(temmlCss)}\n${PRIME}\n`;
}
