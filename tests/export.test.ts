import { describe, expect, it } from 'vitest';

import { cannotExport } from '../src/actions/export';
import { exportPage, exportPath, tokenBlock } from '../src/export/html';
import type { Tab } from '../src/state/tabs.svelte';

/**
 * Экспорт в HTML (задача 110): один файл, который открывается в любом
 * браузере, и ничего из заметки в нём не исполняется.
 */

function tab(kind: Tab['meta']['kind'], large = false): Tab {
  return {
    meta: { id: 1, kind, path: null, title: 'a.md', large },
    editor: null,
    image: null,
    pdf: null,
  } as unknown as Tab;
}

describe('что экспортируется', () => {
  it('текст — да', () => {
    expect(cannotExport(tab('text'))).toBeNull();
  });

  it('картинка, PDF, параметры и огромный файл — нет, и сказано почему', () => {
    expect(cannotExport(tab('image'))).toContain('самим файлом');
    expect(cannotExport(tab('pdf'))).toContain('самим файлом');
    expect(cannotExport(tab('settings'))).toContain('не документ');
    expect(cannotExport(tab('text', true))).toContain('упрощённом режиме');
  });
});

describe('куда предложить сохранить', () => {
  it('рядом с файлом: заметка без .md, код — с расширением', () => {
    expect(exportPath('C:\\заметки\\План.md', 'План.md', true)).toBe('C:\\заметки\\План.html');
    expect(exportPath('C:\\src\\main.rs', 'main.rs', false)).toBe('C:\\src\\main.rs.html');
  });

  it('буфер без файла — одним именем', () => {
    expect(exportPath(null, 'Без имени 1', false)).toBe('Без имени 1.html');
  });
});

describe('страница', () => {
  const page = exportPage('<p>текст</p>', 'План <черновик>', {
    'color-fg-default': '#1f2328',
    'space-3': '8px',
  });

  it('самодостаточна: стиль и токены внутри, документ в колонке', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<meta charset="utf-8">');
    expect(page).toContain('--zn-color-fg-default: #1f2328;');
    expect(page).toContain('.zn-doc');
    expect(page).toContain('.zn-page');
    expect(page).toContain('<article class="zn-doc zn-page">\n<p>текст</p>\n</article>');
  });

  /** Второй пояс: даже проскочивший скрипт браузер не исполнит. */
  it('запрещает скрипты и сеть собственной политикой', () => {
    expect(page).toContain("default-src 'none'");
    expect(page).not.toMatch(/<script/i);
  });

  it('заголовок экранирован', () => {
    expect(page).toContain('<title>План &lt;черновик&gt;</title>');
  });

  /** Значение из чужой темы не должно закрывать `<style>` и дописывать своё. */
  it('токен со скобками или точкой с запятой в файл не попадает', () => {
    const block = tokenBlock({
      good: '4px',
      evil: 'red;}</style><script>alert(1)</script>',
      'bad name': '1px',
    });
    expect(block).toContain('--zn-good: 4px;');
    expect(block).not.toContain('evil');
    expect(block).not.toContain('bad name');
  });
});
