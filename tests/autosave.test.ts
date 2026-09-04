import { describe, expect, it } from 'vitest';
import { autosavable } from '../src/state/autosave-rules';
import type { Buffer } from '../src/ipc/files';

/**
 * Что автосохранение вправе записать (Р-141).
 *
 * Каждый отказ здесь закрывает свой случай, и все они об одном: диалог,
 * всплывший сам по себе, — худшее, что может сделать автосохранение.
 * Человек не нажимал ничего, а его о чём-то спрашивают поверх текста.
 */

function buffer(over: Partial<Buffer> = {}): Buffer {
  return {
    id: 1,
    path: 'C:\\проект\\Заметка.md',
    title: 'Заметка.md',
    encoding: 'utf8',
    bom: false,
    eol: 'lf',
    eolMixed: false,
    modified: true,
    readOnly: false,
    large: false,
    lossy: false,
    encodingConfident: true,
    disk: { modifiedMs: 1, size: 10 },
    ...over,
  };
}

describe('что автосохранение записывает', () => {
  it('обычный изменённый файл', () => {
    expect(autosavable(buffer())).toBe(true);
  });

  it('нетронутый не трогает', () => {
    expect(autosavable(buffer({ modified: false }))).toBe(false);
  });
});

describe('чего автосохранение не трогает', () => {
  /** Сохранение открыло бы системный диалог «сохранить как». */
  it('буфер без файла на диске', () => {
    expect(autosavable(buffer({ path: null }))).toBe(false);
  });

  /**
   * Путь есть, а файла по нему нет: удалили снаружи, переименовали или он
   * не открылся при восстановлении сессии. Запись создала бы файл заново,
   * а создание — действие крупнее обновления.
   *
   * Найдено живой проверкой, и выглядело это так: удалённые файлы
   * возвращались на диск сами через две секунды после первой правки
   * в соседней вкладке.
   */
  it('вкладку, чей файл исчез с диска', () => {
    expect(autosavable(buffer({ disk: null }))).toBe(false);
  });

  /**
   * Запись привела бы переносы к одному виду, а решать это за пользователя
   * мы не будем (Р-018, решение владельца в задаче 51). Точка «изменён»
   * на вкладке остаётся — она и говорит, что файл не записан.
   */
  it('файл со смешанными переносами строк', () => {
    expect(autosavable(buffer({ eolMixed: true }))).toBe(false);
  });

  /** Запись закрепила бы потерю: байты уже не восстановить. */
  it('файл, не раскодированный без потерь', () => {
    expect(autosavable(buffer({ lossy: true }))).toBe(false);
  });

  it('файл только для чтения', () => {
    expect(autosavable(buffer({ readOnly: true }))).toBe(false);
  });

  it('большой файл в упрощённом режиме', () => {
    expect(autosavable(buffer({ large: true }))).toBe(false);
  });
});
