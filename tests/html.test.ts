import { describe, expect, it } from 'vitest';

import { lookupFor } from '../src/editor/callouts';
import {
  CODE_LIMIT,
  IMAGES_LIMIT,
  MARKDOWN_LIMIT,
  TooLarge,
  codeToHtml,
  frontmatterEnd,
  markdownToHtml,
  type ConvertContext,
} from '../src/html/convert';
import { escapeHtml, safeHref } from '../src/html/escape';

/**
 * Вывод HTML (задача 108): печать, экспорт и копирование видят заметку так же,
 * как превью, и ничего из заметки не исполняют.
 */

const images = new Map<string, string>([
  ['рис.png', 'data:image/png;base64,AAAA'],
  ['C:\\заметки\\снимок.png', 'data:image/png;base64,BBBB'],
]);

function context(overrides: Partial<ConvertContext> = {}): ConvertContext {
  return {
    callouts: lookupFor([
      { id: 'note', title: 'Заметка', icon: 'md.callout-note', color: 'accent' },
      { id: 'tip', title: 'Совет', icon: 'md.callout-tip', color: 'success' },
      { id: 'bad', title: 'Плохой', icon: 'md.callout-note', color: 'red; background: url(x)' },
    ]),
    sourcePath: 'C:\\заметки\\заметка.md',
    loadImage: async (link) => {
      const data = images.get(link);
      if (data === undefined) throw new Error('нет такого файла');
      return data;
    },
    loadEmbed: async (target) => {
      const data = images.get(target);
      if (data === undefined) throw new Error('не найдено');
      return data;
    },
    ...overrides,
  };
}

async function html(text: string, overrides: Partial<ConvertContext> = {}): Promise<string> {
  return (await markdownToHtml(text, context(overrides))).html;
}

describe('экранирование и адреса', () => {
  it('текст не становится разметкой', () => {
    expect(escapeHtml('<b>"a" & b</b>')).toBe('&lt;b&gt;&quot;a&quot; &amp; b&lt;/b&gt;');
  });

  it('пускает http, https, mailto и относительные адреса', () => {
    expect(safeHref('https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
    expect(safeHref('mailto:me@example.org')).toBe('mailto:me@example.org');
    expect(safeHref('docs/readme.md')).toBe('docs/readme.md');
    expect(safeHref('#раздел')).toBe('#раздел');
    expect(safeHref('www.example.org')).toBe('http://www.example.org');
  });

  it('не пускает исполняемые и чужие схемы', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHref('java\tscript:alert(1)')).toBeNull();
    expect(safeHref(' javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('file:///C:/secret')).toBeNull();
    expect(safeHref('//evil.example/x')).toBeNull();
  });
});

describe('текст', () => {
  it('заголовки без знаков', async () => {
    expect(await html('# Первый\n\n## Второй ##\n\nТретий\n===\n')).toBe(
      '<h1>Первый</h1>\n<h2>Второй</h2>\n<h1>Третий</h1>',
    );
  });

  /** Превью показывает строки строками — напечатанное их не склеивает. */
  it('перенос строки внутри абзаца остаётся переносом', async () => {
    expect(await html('одна\nдве\n')).toBe('<p>одна<br>\nдве</p>');
    expect(await html('жёстко  \nдальше\n')).toBe('<p>жёстко<br>\nдальше</p>');
  });

  it('строчная разметка своими элементами', async () => {
    expect(await html('**ж** *к* ~~з~~ ==в== `к<о>д`\n')).toBe(
      '<p><strong>ж</strong> <em>к</em> <del>з</del> <mark>в</mark> <code>к&lt;о&gt;д</code></p>',
    );
    expect(await html('==**оба**==\n')).toBe('<p><mark><strong>оба</strong></mark></p>');
  });

  it('экранирует знаки и сохраняет сущности и экранирование markdown', async () => {
    expect(await html('a < b & c > d, &amp; и \\*звёздочка\\*\n')).toBe(
      '<p>a &lt; b &amp; c &gt; d, &amp; и *звёздочка*</p>',
    );
  });

  it('горизонтальная черта', async () => {
    expect(await html('а\n\n---\n\nб\n')).toBe('<p>а</p>\n<hr>\n<p>б</p>');
  });
});

describe('сырой HTML', () => {
  it('белый список — элементами, `<br>` — переносом', async () => {
    expect(await html('<u>под</u> <kbd>Ctrl</kbd> H<sub>2</sub>O x<sup>2</sup> <mark>м</mark><br>дальше\n')).toBe(
      '<p><u>под</u> <kbd>Ctrl</kbd> H<sub>2</sub>O x<sup>2</sup> <mark>м</mark><br>дальше</p>',
    );
  });

  /** Экспортированный файл открывают в браузере: из заметки не исполняется ничего. */
  it('скрипты, обработчики и незнакомые теги выходят текстом', async () => {
    const out = await html('<script>alert(1)</script> <img src=x onerror=alert(1)> <u onclick="x()">а</u>\n');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<u onclick');
    expect(out).toContain('&lt;script&gt;');
  });

  it('блок HTML — текстом, комментарий не выводится', async () => {
    expect(await html('<div onclick="x">\nблок\n</div>\n\n<!-- заметка себе -->\n\nтекст\n')).toBe(
      '<p class="zn-source">&lt;div onclick=&quot;x&quot;&gt;\nблок\n&lt;/div&gt;</p>\n<p>текст</p>',
    );
  });

  it('тег без пары — текстом', async () => {
    expect(await html('<u>без конца\n')).toBe('<p>&lt;u&gt;без конца</p>');
  });
});

describe('ссылки', () => {
  it('ссылка со знакомой схемой — ссылкой, с чужой — текстом', async () => {
    expect(await html('[сайт](https://example.org) и [зло](javascript:alert(1))\n')).toBe(
      '<p><a href="https://example.org">сайт</a> и зло</p>',
    );
  });

  it('адрес в угловых скобках и голый адрес', async () => {
    expect(await html('<https://a.org> и https://b.org\n')).toBe(
      '<p><a href="https://a.org">https://a.org</a> и <a href="https://b.org">https://b.org</a></p>',
    );
  });

  it('ссылка без адреса — текстом', async () => {
    expect(await html('[просто]\n')).toBe('<p>просто</p>');
  });

  /** В отдельном файле вики-ссылке вести некуда. */
  it('вики-ссылка — подписью или тем, что в скобках', async () => {
    expect(await html('[[Заметка]], [[цель|подпись]], [[цель#раздел]]\n')).toBe(
      '<p>Заметка, подпись, цель#раздел</p>',
    );
    expect(await html('**[[Заметка]]**\n')).toBe('<p><strong>Заметка</strong></p>');
  });

  it('в строчном коде вики-ссылка остаётся кодом', async () => {
    expect(await html('`[[не ссылка]]`\n')).toBe('<p><code>[[не ссылка]]</code></p>');
  });
});

describe('картинки', () => {
  it('локальная — встроенной, сетевая — подписью (Р-202)', async () => {
    expect(await html('![рисунок](рис.png) и ![сеть](https://x.org/a.png)\n')).toBe(
      '<p><img src="data:image/png;base64,AAAA" alt="рисунок"> и сеть</p>',
    );
  });

  it('вставка по имени — картинкой, вставка заметки — как написано', async () => {
    expect(await html('![[рис.png]] и ![[рис.png|подпись]] и ![[заметка]]\n')).toBe(
      '<p><img src="data:image/png;base64,AAAA" alt="рис.png"> и ' +
        '<img src="data:image/png;base64,AAAA" alt="подпись"> и ![[заметка]]</p>',
    );
  });

  it('недоставшаяся картинка — подписью и словом для человека', async () => {
    const out = await markdownToHtml('![нет](пропала.png)\n', context());
    expect(out.html).toBe('<p>нет</p>');
    expect(out.problems).toEqual(['картинка «пропала.png» не показана: Error: нет такого файла']);
  });

  it('общий предел байтов картинок называется', async () => {
    const huge = 'x'.repeat(IMAGES_LIMIT);
    const out = await markdownToHtml('![а](рис.png) ![б](ещё.png)\n', context({
      loadImage: async () => huge,
    }));
    expect(out.html.match(/<img/g)?.length).toBe(1);
    expect(out.problems.join()).toContain('1 вышли подписью');
  });
});

describe('цитаты и коллауты', () => {
  it('цитата без знаков, строки переносом', async () => {
    expect(await html('> одна\n> две\n')).toBe('<blockquote>\n<p>одна<br>\nдве</p>\n</blockquote>');
  });

  it('коллаут — карточкой со значком, заголовком и телом', async () => {
    const out = await html('> [!tip] Совет дня\n> тело\n> ещё\n');
    expect(out).toMatch(/^<div class="zn-callout" style="--callout-color: var\(--zn-color-success\)">/);
    expect(out).toContain('<span class="zn-callout-icon"><svg');
    expect(out).toContain('<span>Совет дня</span>');
    expect(out).toContain('<div class="zn-callout-body">\n<p>тело<br>\nещё</p>\n</div>');
  });

  /** Р-178: вывод не сочиняет слов — нет заголовка, нет и подписи. */
  it('коллаут без заголовка — один значок', async () => {
    const out = await html('> [!tip]\n> тело\n');
    expect(out).not.toContain('Совет');
    expect(out).toContain('</svg></span></div>');
  });

  it('незнакомый тип — заметкой, чужой цвет не попадает в атрибут', async () => {
    expect(await html('> [!придумал] А\n')).toContain('--callout-color: var(--zn-color-accent)');
    const bad = await html('> [!bad] А\n');
    expect(bad).not.toContain('url(x)');
    expect(bad).toContain('--callout-color: var(--zn-color-accent)');
  });
});

describe('списки и задачи', () => {
  it('тесный список — без абзацев, свободный — с ними', async () => {
    expect(await html('- а\n- б\n')).toBe('<ul>\n<li>а</li>\n<li>б</li>\n</ul>');
    expect(await html('- а\n\n- б\n')).toBe('<ul>\n<li><p>а</p></li>\n<li><p>б</p></li>\n</ul>');
  });

  it('нумерованный помнит начало, вложенный — внутри пункта', async () => {
    expect(await html('3. три\n4. четыре\n')).toBe('<ol start="3">\n<li>три</li>\n<li>четыре</li>\n</ol>');
    expect(await html('- а\n  - б\n')).toBe('<ul>\n<li>а\n<ul>\n<li>б</li>\n</ul></li>\n</ul>');
  });

  it('задача — значком, сделанная — зачёркнутым текстом', async () => {
    const out = await html('- [ ] купить\n- [x] позвонить\n');
    expect(out).toContain('<li class="zn-task-item"><span class="zn-task"><svg');
    expect(out).toContain('<li class="zn-task-item zn-task-item-done"><span class="zn-task"><svg');
    expect(out).toContain('<span class="zn-task-text-done">позвонить</span>');
  });
});

describe('код', () => {
  it('блок раскрашен своим языком, классами ролей', async () => {
    const out = await html('```js\nconst a = "x";\n```\n');
    expect(out).toMatch(/^<pre class="zn-code" data-lang="js"><code><span class="zn-line">/);
    expect(out).toContain('<span class="zn-syn-keyword">const</span>');
    expect(out).toContain('<span class="zn-syn-string">&quot;x&quot;</span>');
  });

  it('незнакомый язык и mermaid — без раскраски, но с подписью языка', async () => {
    expect(await html('```mermaid\ngraph TD\n```\n')).toBe(
      '<pre class="zn-code" data-lang="mermaid"><code><span class="zn-line">graph TD</span></code></pre>',
    );
  });

  it('код экранируется', async () => {
    expect(await html('```\n<script>\n```\n')).toContain('&lt;script&gt;');
  });

  it('в цитате без знаков цитаты, в списке без отступа пункта', async () => {
    expect(await html('> ```\n> a\n>\n> b\n> ```\n')).toContain(
      '<code><span class="zn-line">a</span>\n<span class="zn-line"></span>\n<span class="zn-line">b</span></code>',
    );
    expect(await html('- пункт\n  ```\n  code\n    глубже\n  ```\n')).toContain(
      '<span class="zn-line">code</span>\n<span class="zn-line">  глубже</span>',
    );
  });

  it('блок отступом', async () => {
    expect(await html('текст\n\n    a\n      b\n')).toContain(
      '<pre class="zn-code"><code><span class="zn-line">a</span>\n<span class="zn-line">  b</span></code></pre>',
    );
  });

  it('файл кода целиком — строками для номеров', async () => {
    const out = await codeToHtml('fn main() {\n}\n', 'rust');
    expect(out.html).toMatch(/^<pre class="zn-code" data-lang="rust"><code>/);
    expect(out.html).toContain('<span class="zn-syn-keyword">fn</span>');
    expect(out.html.match(/class="zn-line"/g)?.length).toBe(3);
    expect((await codeToHtml('<a>', null)).html).toBe(
      '<pre class="zn-code"><code><span class="zn-line">&lt;a&gt;</span></code></pre>',
    );
  });
});

describe('таблицы', () => {
  it('выравнивание и строчная разметка в ячейках', async () => {
    expect(await html('| a | **б** |\n|:--|--:|\n| 1 | [[x]] |\n')).toBe(
      '<table>\n<thead>\n<tr><th style="text-align: left">a</th><th style="text-align: right"><strong>б</strong></th></tr>\n' +
        '</thead>\n<tbody>\n<tr><td style="text-align: left">1</td><td style="text-align: right">x</td></tr>\n</tbody>\n</table>',
    );
  });

  /**
   * GFM: лишние ячейки отбрасываются, недостающие — пустые. Чаще всего
   * лишняя — это `[[цель|подпись]]`, разрезанная палкой; в таблице
   * подпись пишут `\|`, как в Obsidian.
   */
  it('рваные строки по GFM, подпись вики-ссылки через `\\|`', async () => {
    const out = await html('| а | б |\n|---|---|\n| 1 |\n| [[цель|x]] | 2 | 3 |\n| [[цель\\|подпись]] | 4 |\n');
    expect(out).toContain('<tr><td>1</td><td></td></tr>');
    expect(out).toContain('<tr><td>[[цель</td><td>x]]</td></tr>');
    expect(out).toContain('<tr><td>подпись</td><td>4</td></tr>');
  });

  /** У пустой ячейки узла нет — счёт по узлам сдвинул бы столбцы. */
  it('пустая ячейка не сдвигает столбцы', async () => {
    expect(await html('| a | b | c |\n|---|---|---|\n|  | 2 | 3 |\n')).toContain(
      '<tr><td></td><td>2</td><td>3</td></tr>',
    );
  });
});

describe('frontmatter и пределы', () => {
  it('служебные поля не выводятся', async () => {
    expect(frontmatterEnd('---\ntags: [a]\n---\nтело\n')).toBe(18);
    expect(await html('---\ntags: [a]\n---\nтело\n')).toBe('<p>тело</p>');
  });

  it('черта посреди текста и незакрытая ограда — не frontmatter', () => {
    expect(frontmatterEnd('текст\n---\nа\n---\n')).toBe(0);
    expect(frontmatterEnd('---\nбез конца\n')).toBe(0);
  });

  it('слишком большой файл — отказ словами', async () => {
    await expect(markdownToHtml('a'.repeat(MARKDOWN_LIMIT + 1), context())).rejects.toBeInstanceOf(TooLarge);
    await expect(codeToHtml('a'.repeat(CODE_LIMIT + 1), null)).rejects.toBeInstanceOf(TooLarge);
  });
});
