/**
 * Экранирование и адреса для вывода HTML (задача 108).
 *
 * Вывод открывают в браузере — экспортированный файл, — и вставляют в чужие
 * программы — копирование с оформлением. Всё, что пришло из заметки,
 * становится текстом, а не разметкой: сырой HTML проходит только белым
 * списком (Р-262), адрес ссылки — только знакомой схемой.
 */

/** Текст внутри элемента. `"` экранируется тоже: текст бывает и в атрибуте. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Годный ли адрес для `href`, и какой.
 *
 * Разрешены `http:`, `https:`, `mailto:` и адреса без схемы — относительный
 * путь и якорь `#раздел`. `javascript:`, `data:`, `file:` и любая незнакомая
 * схема — `null`: такая ссылка выходит своим текстом. Обработчик события
 * в чужой заметке — ровно то, чего экспортированный файл делать не должен.
 *
 * `www.пример.рф` без схемы GFM считает адресом — ему дописывается `http://`,
 * как делает GitHub.
 */
export function safeHref(url: string): string | null {
  let text = url.trim();
  if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1).trim();
  if (text === '') return null;

  // Управляющие знаки и пробелы внутри схемы браузер выбрасывает молча:
  // `java\tscript:` для него то же, что `javascript:`. Проверяем схему
  // на очищенной строке.
  const bare = text.replace(/[\x00-\x20\x7f]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(bare);
  if (scheme) {
    const name = scheme[1]!.toLowerCase();
    return name === 'http' || name === 'https' || name === 'mailto' ? text : null;
  }

  // `//сервер/путь` — адрес другого сервера без схемы; ссылки в заметке
  // так не пишут, а в экспортированном файле он превратился бы в `file:`.
  if (bare.startsWith('//')) return null;

  if (/^www\./i.test(text)) return `http://${text}`;
  return text;
}
