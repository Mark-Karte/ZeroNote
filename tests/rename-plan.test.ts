import { describe, expect, it } from 'vitest';
import { describePlan, movedPath, splitPlan } from '../src/actions/rename-plan';
import type { FileEdits } from '../src/ipc/tree';

/**
 * Вопрос, который задаётся перед правкой чужих файлов (Р-136).
 *
 * Проверяется то, из чего человек делает вывод: какие файлы попадут
 * в правку, какие нет и почему. Ошибка здесь — не опечатка, а неверно
 * поставленный вопрос.
 */

function file(inside: string, count: number): FileEdits {
  return {
    path: `C:\\проект\\${inside.replace(/\//g, '\\')}`,
    inside,
    edits: Array.from({ length: count }, (_, i) => ({
      offset: i * 10,
      was: 'Планы',
      becomes: 'Задачи',
    })),
  };
}

describe('куда переезжает путь', () => {
  it('сам переименованный файл', () => {
    expect(movedPath('C:\\п\\Планы.md', 'C:\\п\\Планы.md', 'C:\\п\\Задачи.md')).toBe(
      'C:\\п\\Задачи.md',
    );
  });

  it('всё внутри переименованной папки', () => {
    expect(movedPath('C:\\п\\работа\\Планы.md', 'C:\\п\\работа', 'C:\\п\\дела')).toBe(
      'C:\\п\\дела\\Планы.md',
    );
  });

  /** Без разделителя `работа` поймала бы и `работа-старое`. */
  it('но не соседнюю папку с похожим именем', () => {
    expect(movedPath('C:\\п\\работа-старое\\а.md', 'C:\\п\\работа', 'C:\\п\\дела')).toBeNull();
  });

  it('посторонний путь не трогает', () => {
    expect(movedPath('C:\\п\\Другое.md', 'C:\\п\\Планы.md', 'C:\\п\\Задачи.md')).toBeNull();
  });
});

describe('что попадёт в правку', () => {
  /**
   * Вкладка внутри переименованной папки: план приходит с новым путём,
   * а вкладка ещё лежит по старому. Не переведи мы её — файл
   * с несохранёнными правками уехал бы в правку вопреки Р-138.
   */
  it('вкладка внутри переименованной папки всё равно отделяется', () => {
    const plan: FileEdits[] = [
      {
        path: 'C:\\проект\\дела\\Дневник.md',
        inside: 'дела/Дневник.md',
        edits: [{ offset: 0, was: 'Планы', becomes: 'Задачи' }],
      },
    ];
    const open = 'C:\\проект\\работа\\Дневник.md';
    const busy = [movedPath(open, 'C:\\проект\\работа', 'C:\\проект\\дела') ?? open];

    expect(splitPlan(plan, busy).blocked).toHaveLength(1);
  });

  it('без открытых вкладок правятся все файлы', () => {
    const split = splitPlan([file('Дневник.md', 2), file('работа/Отчёт.md', 1)], []);

    expect(split.editable).toHaveLength(2);
    expect(split.blocked).toHaveLength(0);
  });

  /** Вкладка с несохранёнными правками на диске не трогается (Р-138). */
  it('файл с несохранёнными правками отделяется', () => {
    const files = [file('Дневник.md', 2), file('Черновик.md', 1)];
    const split = splitPlan(files, ['C:\\проект\\Черновик.md']);

    expect(split.editable.map((f) => f.inside)).toEqual(['Дневник.md']);
    expect(split.blocked.map((f) => f.inside)).toEqual(['Черновик.md']);
  });

  /**
   * Windows не различает регистр путей, а путь вкладки и путь из плана
   * приходят разными дорогами: один от пользователя, другой из индекса.
   * Совпадение по регистру здесь было бы случайностью.
   */
  it('регистр пути не должен решать', () => {
    const split = splitPlan([file('Черновик.md', 1)], ['c:\\ПРОЕКТ\\черновик.md']);

    expect(split.blocked).toHaveLength(1);
  });
});

describe('о чём спрашивают человека', () => {
  it('называет число ссылок и файлов', () => {
    const split = splitPlan([file('Дневник.md', 2), file('работа/Отчёт.md', 1)], []);
    const text = describePlan('Планы.md', split);

    expect(text).toContain('«Планы.md»');
    expect(text).toContain('3 ссылки');
    expect(text).toContain('2 файлах');
  });

  /** Список показывается целиком: «и ещё 12 файлов» отвечает наоборот. */
  it('перечисляет все файлы с числом правок', () => {
    const split = splitPlan([file('Дневник.md', 2), file('работа/Отчёт.md', 1)], []);
    const text = describePlan('Планы.md', split);

    expect(text).toContain('Дневник.md — 2');
    expect(text).toContain('работа/Отчёт.md — 1');
  });

  /** Нетронутые называются вместе с причиной: иначе непонятно, что делать. */
  it('объясняет, почему часть файлов не тронута', () => {
    const split = splitPlan(
      [file('Дневник.md', 1), file('Черновик.md', 1)],
      ['C:\\проект\\Черновик.md'],
    );
    const text = describePlan('Планы.md', split);

    expect(text).toContain('с несохранёнными правками');
    expect(text).toContain('Черновик.md — 1');
  });

  /** Про несохранённые правки речи нет, когда таких файлов нет. */
  it('молчит о нетронутых, когда их нет', () => {
    const text = describePlan('Планы.md', splitPlan([file('Дневник.md', 1)], []));

    expect(text).not.toContain('несохранённ');
  });

  /** Числительные склоняются: «1 ссылка», а не «1 ссылок». */
  it('склоняет числительные', () => {
    expect(describePlan('П.md', splitPlan([file('а.md', 1)], []))).toContain('1 ссылка');
    expect(describePlan('П.md', splitPlan([file('а.md', 2)], []))).toContain('2 ссылки');
    expect(describePlan('П.md', splitPlan([file('а.md', 11)], []))).toContain('11 ссылок');
  });
});
