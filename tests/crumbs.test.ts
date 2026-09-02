import { describe, expect, it } from 'vitest';
import { crumbsFor, type CrumbRoot } from '../src/ui/crumbs';

/**
 * Крошки — единственное место в шапке, где есть логика: разбор пути, выбор
 * корня, поведение на файле вне корней. Всё остальное там разметка.
 */

const ROOTS: CrumbRoot[] = [
  { path: 'C:\\Users\\user\\Хранилище', name: 'Хранилище' },
  { path: 'C:\\Проекты\\ZeroNote', name: 'ZeroNote' },
];

const text = (path: string | null, roots = ROOTS): string[] =>
  crumbsFor(path, roots).map((c) => c.text);

describe('хлебные крошки', () => {
  it('файл в корне показывает имя корня и путь от него', () => {
    expect(text('C:\\Users\\user\\Хранилище\\Заметки\\идея.md')).toEqual([
      'Хранилище',
      'Заметки',
      'идея.md',
    ]);
  });

  it('файл прямо в корне — это две крошки', () => {
    expect(text('C:\\Проекты\\ZeroNote\\README.md')).toEqual([
      'ZeroNote',
      'README.md',
    ]);
  });

  it('последняя крошка помечена как файл, остальные нет', () => {
    const crumbs = crumbsFor('C:\\Проекты\\ZeroNote\\src\\main.ts', ROOTS);
    expect(crumbs.map((c) => c.leaf)).toEqual([false, false, true]);
  });

  it('регистр пути не мешает узнать корень', () => {
    // Windows не различает регистр, и путь из файла сессии может отличаться
    // от того, каким корень был добавлен.
    expect(text('c:\\users\\USER\\хранилище\\Заметки\\идея.md')).toEqual([
      'Хранилище',
      'Заметки',
      'идея.md',
    ]);
  });

  it('прямые косые разбираются наравне с обратными', () => {
    expect(text('C:/Проекты/ZeroNote/src/main.ts')).toEqual([
      'ZeroNote',
      'src',
      'main.ts',
    ]);
  });

  it('из вложенных корней выбирается ближний к файлу', () => {
    const nested: CrumbRoot[] = [
      { path: 'C:\\Проекты', name: 'Проекты' },
      { path: 'C:\\Проекты\\ZeroNote', name: 'ZeroNote' },
    ];
    expect(text('C:\\Проекты\\ZeroNote\\src\\main.ts', nested)).toEqual([
      'ZeroNote',
      'src',
      'main.ts',
    ]);
  });

  it('похожее имя папки не считается корнем', () => {
    // «ZeroNote-старый» начинается с «ZeroNote», но корнем ему не является:
    // сравнение идёт по границе части пути, а не по началу строки.
    expect(text('C:\\Проекты\\ZeroNote-старый\\README.md')).toEqual([
      '…',
      'ZeroNote-старый',
      'README.md',
    ]);
  });

  it('файл вне корней показывает многоточие и папку', () => {
    expect(text('C:\\Users\\user\\Downloads\\счёт.txt')).toEqual([
      '…',
      'Downloads',
      'счёт.txt',
    ]);
  });

  it('файл в корне диска обходится без многоточия', () => {
    // Отбрасывать нечего, и «…» означало бы скрытые части пути, которых нет.
    expect(text('C:\\заметка.txt')).toEqual(['C:', 'заметка.txt']);
  });

  it('буфер без файла крошек не даёт', () => {
    expect(crumbsFor(null, ROOTS)).toEqual([]);
  });

  it('без корней всё равно что-то показывает', () => {
    expect(text('C:\\Users\\user\\заметка.md', [])).toEqual([
      '…',
      'user',
      'заметка.md',
    ]);
  });
});
