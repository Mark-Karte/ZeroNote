import { describe, expect, it } from 'vitest';

import { cannotPrint } from '../src/actions/print';
import { pageMargin, pageTitle, printStyles } from '../src/print/print';
import type { Tab } from '../src/state/tabs.svelte';

/**
 * Печать (задача 109): что можно печатать и каким стилем.
 *
 * Сам диалог печати — окно WebView2, и проверяется он только глазами.
 * Здесь то, что можно проверить без окна: правила «можно ли» и стиль.
 */

function tab(kind: Tab['meta']['kind'], large = false): Tab {
  return {
    meta: {
      id: 1,
      kind,
      path: 'C:\\заметки\\a.md',
      title: 'a.md',
      encoding: 'utf-8',
      bom: false,
      eol: 'lf',
      eolMixed: false,
      modified: false,
      readOnly: false,
      large,
      lossy: false,
      encodingConfident: true,
      disk: null,
    },
    editor: null,
    image: null,
    pdf: null,
  } as unknown as Tab;
}

describe('что печатается', () => {
  it('текст и картинка — да', () => {
    expect(cannotPrint(tab('text'))).toBeNull();
    expect(cannotPrint(tab('image'))).toBeNull();
  });

  /** Команду зовут и из палитры — ответ словами, а не молчание. */
  it('PDF, параметры и огромный файл — нет, и сказано почему', () => {
    expect(cannotPrint(tab('pdf'))).toContain('своей программой');
    expect(cannotPrint(tab('settings'))).toContain('не документ');
    expect(cannotPrint(tab('text', true))).toContain('упрощённом режиме');
    expect(cannotPrint(null)).toBeTruthy();
  });
});

describe('стиль печати', () => {
  it('поле страницы — из токена, но только длиной', () => {
    expect(pageMargin('15mm')).toBe('15mm');
    expect(pageMargin('0.5in')).toBe('0.5in');
    expect(pageMargin('20mm; } body { display: none')).toBe('20mm');
    expect(pageMargin(undefined)).toBe('20mm');
  });

  /** Заголовок листа идёт в колонтитул и в имя PDF: «План.pdf», не «План.md.pdf». */
  it('заголовок листа — заметка без расширения, код — с ним', () => {
    expect(pageTitle('План.md', true)).toBe('План');
    expect(pageTitle('notes.markdown', true)).toBe('notes');
    expect(pageTitle('main.rs', false)).toBe('main.rs');
  });

  it('несёт стиль документа, режим печати и поле страницы', () => {
    const css = printStyles('12mm');
    expect(css).toContain('.zn-doc');
    expect(css).toContain('@media print');
    expect(css).toContain('@page { margin: 12mm; }');
  });
});
