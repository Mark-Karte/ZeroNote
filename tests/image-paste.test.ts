import { describe, expect, it } from 'vitest';

import { pastedContent } from '../src/editor/image-paste';
import { isPng, stamp } from '../src/actions/paste-image';
import { placeOf, valueOf } from '../src/ui/settings/attachments';

/**
 * Картинка из буфера обмена в заметку (задача 146).
 *
 * Окна здесь нет: проверяется решение «текст или картинка», имя файла
 * и настройка. Сама вставка, холст и запись — живой проверкой.
 */

/** Содержимое вставки, как его видит обработчик события. */
function clipboard(text: string, files: File[]): Pick<DataTransfer, 'getData' | 'files'> {
  return {
    getData: (format: string) => (format === 'text/plain' ? text : ''),
    files: files as unknown as FileList,
  };
}

const shot = new File([new Uint8Array([0x89, 0x50])], 'image.png', { type: 'image/png' });

describe('что вставлять', () => {
  /** Word и браузер кладут с текстом и картинку — вставляется текст. */
  it('текст побеждает картинку', () => {
    expect(pastedContent(clipboard('абзац', [shot]))).toEqual({ kind: 'text' });
  });

  it('картинка без текста — наша', () => {
    expect(pastedContent(clipboard('', [shot]))).toEqual({ kind: 'image', file: shot });
  });

  /** Вебвью картинку не отдал — искать её будет ядро. */
  it('ни текста, ни картинки — спросить ядро', () => {
    expect(pastedContent(clipboard('', []))).toEqual({ kind: 'image', file: null });
    const text = new File(['а'], 'a.txt', { type: 'text/plain' });
    expect(pastedContent(clipboard('', [text]))).toEqual({ kind: 'image', file: null });
  });
});

describe('имя файла', () => {
  it('отметка — местное время без знаков, как у Obsidian', () => {
    expect(stamp(new Date(2026, 8, 28, 4, 5, 6))).toBe('20260928040506');
    expect(stamp(new Date(2026, 11, 31, 23, 59, 59))).toBe('20261231235959');
  });

  it('PNG узнаётся по подписи', () => {
    expect(isPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
    expect(isPng(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe(false);
    expect(isPng(new Uint8Array([0x89, 0x50]))).toBe(false);
  });
});

describe('папка вложений в окне параметров', () => {
  it('строка файла — выбор и имя, и обратно', () => {
    for (const value of ['./', '/', './attachments', 'Вложения/Картинки']) {
      expect(valueOf(placeOf(value))).toBe(value);
    }
    expect(placeOf('./img')).toEqual({ kind: 'beside', name: 'img' });
    expect(placeOf('Вложения')).toEqual({ kind: 'folder', name: 'Вложения' });
  });

  it('пусто и вольное написание — как читает ядро', () => {
    expect(placeOf('')).toEqual({ kind: 'note', name: '' });
    expect(placeOf('.\\img\\')).toEqual({ kind: 'beside', name: 'img' });
    expect(placeOf('/Вложения/')).toEqual({ kind: 'folder', name: 'Вложения' });
  });

  /**
   * Выбрали вид с именем, а имени ещё нет. По-русски — решение владельца;
   * `attachments`, как у Obsidian, — вместе с переводом интерфейса.
   */
  it('имени нет — Вложения', () => {
    expect(valueOf({ kind: 'beside', name: '' })).toBe('./Вложения');
    expect(valueOf({ kind: 'folder', name: '  ' })).toBe('Вложения');
    expect(valueOf({ kind: 'note', name: 'img' })).toBe('./');
  });
});
