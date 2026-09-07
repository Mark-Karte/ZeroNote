import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Оторванный хвост абзаца в документации.
 *
 * `DESIGN.md` правится вставками — новый раздел, новое решение, — и вставка,
 * попавшая не на границу абзаца, а внутрь него, разрывает чужой текст: конец
 * предложения остаётся стоять отдельным абзацем, а решение, у которого его
 * забрали, обрывается на полуслове.
 *
 * Это случалось **трижды**: осколок Р-189 («на трёх видах сразу»), осколок
 * Р-191 («громкий отказ вместо тихой неправды») и целый абзац Р-195 про
 * `ShellExecuteW`, уехавший в конец Р-204. Каждый раз находилось глазами
 * и случайно — документ большой, и никто не перечитывает его целиком.
 *
 * Признак у поломки простой и почти без ложных срабатываний: **абзац,
 * начинающийся со строчной буквы.** Обычный абзац начинается с заглавной,
 * со знака разметки или с обратной кавычки; строчная буква в начале — это
 * середина предложения, оставшаяся без начала.
 *
 * Проверка нарочно грубая: она не понимает текста и не пытается. Её дело —
 * заметить шов.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Документы, которые правятся вставками и потому рвутся. */
const DOCS = ['DESIGN.md', 'CLAUDE.md', 'README.md'];

/**
 * Слова, которыми абзацу начинаться можно.
 *
 * Строчными пишутся имена — и это единственный законный случай. Список
 * держится коротким нарочно: чем он длиннее, тем меньше проверка значит.
 */
const ALLOWED = ['pdf.js'];

interface Orphan {
  file: string;
  line: number;
  text: string;
}

function findOrphans(file: string): Orphan[] {
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  const found: Orphan[] = [];

  let fenced = false;
  let afterBlank = true;

  lines.forEach((line, index) => {
    // Внутри ограждённого блока лежит код, а не проза.
    if (line.startsWith('```')) {
      fenced = !fenced;
      afterBlank = false;
      return;
    }
    if (fenced) {
      afterBlank = false;
      return;
    }
    if (line.trim() === '') {
      afterBlank = true;
      return;
    }

    if (afterBlank && /^[a-zа-яё]/.test(line)) {
      const allowed = ALLOWED.some((word) => line.startsWith(word));
      if (!allowed) {
        found.push({ file, line: index + 1, text: line.slice(0, 60) });
      }
    }
    afterBlank = false;
  });

  return found;
}

describe('документация', () => {
  it('не содержит оторванных хвостов абзацев', () => {
    const orphans = DOCS.flatMap(findOrphans);
    const report = orphans.map((o) => `${o.file}:${o.line} — «${o.text}»`);
    expect(report).toEqual([]);
  });

  it('видит хвост, если он появится', () => {
    // Проверка, которая не может провалиться, выглядит как проходящая:
    // убеждаемся, что признак вообще срабатывает.
    const sample = ['Абзац кончился так.', '', 'громкий отказ вместо тихой неправды.'];
    const suspicious = sample.filter(
      (line, index) => index > 0 && sample[index - 1] === '' && /^[a-zа-яё]/.test(line),
    );
    expect(suspicious).toEqual(['громкий отказ вместо тихой неправды.']);
  });
});
