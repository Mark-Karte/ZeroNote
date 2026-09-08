import { describe, expect, it } from 'vitest';
import {
  describeDone,
  describeReplace,
  describeUndo,
  describeUndone,
  previewLines,
  replaceTitle,
} from '../src/actions/replace-plan';
import { splitPlan } from '../src/actions/rename-plan';
import type { ReplaceFile, ReplacePlan } from '../src/ipc/edits';

/**
 * Текст вопроса перед заменой по проекту (задача 88).
 *
 * Проверяется не оформление, а обещания: сколько файлов будет изменено,
 * какие именно, что не будет тронуто и почему. По этому тексту человек
 * соглашается менять чужие файлы пачкой — если он врёт, врать будет
 * приложение.
 */

function file(inside: string, count: number, lines: string[] = []): ReplaceFile {
  return {
    rootId: 1,
    path: 'C:\\проект\\' + inside.replace(/\//g, '\\'),
    inside,
    edits: Array.from({ length: count }, (_, i) => ({
      offset: i * 10,
      was: 'план',
      becomes: 'замысел',
    })),
    preview: lines.map((text, i) => ({ line: i + 1, text })),
  };
}

function plan(files: ReplaceFile[], extra: Partial<ReplacePlan> = {}): ReplacePlan {
  return {
    files,
    total: files.reduce((sum, f) => sum + f.edits.length, 0),
    scanned: 120,
    lossy: [],
    stopped: false,
    overflow: false,
    ...extra,
  };
}

describe('заголовок вопроса', () => {
  it('называет обе строки', () => {
    expect(replaceTitle('план', 'замысел')).toBe('Заменить «план» на «замысел»?');
  });

  /**
   * Замена на пустоту — это удаление, и просить согласия надо на него:
   * «заменить «TODO» на «»» человек прочитает как опечатку.
   */
  it('пустая замена называется удалением', () => {
    expect(replaceTitle('TODO ', '')).toBe('Удалить «TODO »?');
  });
});

describe('список до записи', () => {
  it('считает совпадения и файлы', () => {
    const files = [file('Планы.md', 4), file('заметки/Идеи.md', 3)];
    const text = describeReplace(plan(files), splitPlan(files, []));

    expect(text).toContain('7 совпадений в 2 файлах');
    expect(text).toContain('Планы.md — 4');
    expect(text).toContain('заметки/Идеи.md — 3');
  });

  /**
   * Область названа первой строкой (замечание владельца после задачи 88):
   * «во всех открытых папках» и «только в этой» — разные обещания, и человек
   * должен видеть, какое из них подтверждает. Одинаковые библиотеки лежат
   * в разных проектах, и правка в одном не должна доезжать до остальных.
   */
  it('называет папку, в которой заменяет', () => {
    const files = [file('util.rs', 1)];

    expect(describeReplace(plan(files), splitPlan(files, []))).toContain(
      'Во всех открытых папках',
    );
    expect(describeReplace(plan(files), splitPlan(files, []), 'первый')).toContain(
      'В папке «первый»',
    );
  });

  /**
   * Список файлов показывается целиком: это единственное место, где человек
   * видит, во что ввязывается. Правило пришло из переименования (Р-136).
   */
  it('не обрезает список файлов', () => {
    const files = Array.from({ length: 30 }, (_, i) => file(`файл-${i}.md`, 1));
    const text = describeReplace(plan(files), splitPlan(files, []));

    expect(text).toContain('файл-29.md — 1');
  });

  /** А строк показывает первые двадцать: их бывают тысячи. */
  it('обрезает строки и говорит об этом', () => {
    const files = Array.from({ length: 30 }, (_, i) =>
      file(`файл-${i}.md`, 1, ['строка с планом']),
    );
    const text = describeReplace(plan(files), splitPlan(files, []));

    expect(text).toContain('Строки (первые 20):');
    expect(text).toContain('файл-0.md:1  строка с планом');
    expect(text).not.toContain('файл-25.md:1');
  });

  /**
   * Вкладка с несохранёнными правками названа отдельно и с причиной (Р-138).
   * Без числа совпадений: оно посчитано по файлу на диске, а на экране в такой
   * вкладке другой текст.
   */
  it('называет то, что не будет тронуто, и почему', () => {
    const busy = 'C:\\проект\\Черновик.md';
    const files = [file('Планы.md', 2), file('Черновик.md', 5)];
    const text = describeReplace(plan(files), splitPlan(files, [busy]));

    expect(text).toContain('2 совпадения в 1 файле');
    expect(text).toContain('несохранёнными правками');
    expect(text).toContain('Черновик.md');
    expect(text).not.toContain('Черновик.md — 5');
  });

  it('называет файлы, которые не читаются без потерь', () => {
    const files = [file('Планы.md', 1)];
    const text = describeReplace(
      plan(files, { lossy: ['архив/старое.txt'] }),
      splitPlan(files, []),
    );

    expect(text).toContain('читаются своей кодировкой без потерь');
    expect(text).toContain('архив/старое.txt');
  });
});

describe('строки с совпадениями', () => {
  it('склеивают путь, номер строки и текст', () => {
    const lines = previewLines([file('заметки/Планы.md', 1, ['срок: план на неделю'])]);

    expect(lines).toEqual(['заметки/Планы.md:1  срок: план на неделю']);
  });

  it('берут из каждого файла и останавливаются на пределе', () => {
    const files = [file('а.md', 2, ['раз', 'два']), file('б.md', 1, ['три'])];

    expect(previewLines(files, 3)).toHaveLength(3);
    expect(previewLines(files, 2)).toEqual(['а.md:1  раз', 'а.md:2  два']);
  });
});

describe('итог и отмена', () => {
  it('говорит, сколько заменено', () => {
    expect(describeDone(7, 2)).toBe('Заменено: 7 совпадений в 2 файлах');
    expect(describeDone(1, 1)).toBe('Заменено: 1 совпадение в 1 файле');
  });

  it('говорит, сколько отменено', () => {
    expect(describeUndone(3, 1)).toBe('Замена отменена: 3 совпадения в 1 файле');
  });

  /** Вопрос об отмене показывает направление: что во что вернётся. */
  it('называет направление отмены', () => {
    const text = describeUndo('план', 'замысел', 7, 2);

    expect(text).toContain('«замысел» станет «план»');
    expect(text).toContain('7 совпадений в 2 файлах');
    // Отмена не трогает файлы, изменённые после замены, и молчать об этом
    // нельзя: человек ждёт возврата всего.
    expect(text).toContain('изменённые после замены');
  });

  it('отмена удаления называется возвратом', () => {
    expect(describeUndo('TODO ', '', 1, 1)).toContain('«TODO » вернётся');
  });

  /**
   * У замены по выражению направление не назвать подстановками: «$2=$1»
   * станет «(\w+)=(\w+)» — не то, что произойдёт. Называем саму замену.
   */
  it('замену по выражению называет выражением', () => {
    const text = describeUndo(String.raw`(\w+)=(\w+)`, '$2=$1', 2, 1, true);

    expect(text).toContain('Замена по выражению');
    expect(text).toContain('$2=$1');
    expect(text).not.toContain('станет «(');
  });
});
