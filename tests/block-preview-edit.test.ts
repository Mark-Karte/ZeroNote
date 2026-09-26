import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type RangeSet, type RangeValue } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

import { blockField, blockShapes } from '../src/editor/block-preview';
import { lookupFor } from '../src/editor/callouts';
import { markdownSupport } from '../src/editor/markdown-language';

/**
 * Строки и клетки поля после правки (приёмка этапа 18): поле сдвигает
 * прошлые сквозь правку и пересобирает только задетый отрезок. Здесь —
 * что это даёт ровно то же, что сборка с нуля, на правках вразброс:
 * открыть и закрыть ограду, сделать строку цитатой и коллаутом,
 * подчеркнуть заголовок, стереть кусок через границу блоков.
 */

const LIST = lookupFor([{ id: 'tip', title: 'Совет', icon: 'md.callout-tip', color: 'success' }]);

const START = [
  '---',
  'tags: [a]',
  '---',
  '',
  '# Заголовок',
  '',
  'Абзац с текстом, достаточно длинный, чтобы разбор шёл кусками.',
  '',
  '> [!tip] Совет',
  '> строка карточки',
  '>',
  '> ```sh',
  '> ls',
  '> ```',
  '',
  '## Второй',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '> простая цитата',
  '> > вложенная',
  '',
  'Хвост.',
  '',
].join('\n');

/** Куски, которые правка вставляет: всё, что меняет строение блоков. */
const PIECES = [
  '\n',
  '\n\n',
  '> ',
  '> [!tip] Новый\n',
  '```\n',
  '# ',
  '===\n',
  'текст',
  '%%\n',
  '---\n',
  '| x |\n|---|\n',
  '>',
];

/** Предсказуемый разброс: тест обязан падать одинаково при каждом прогоне. */
function random(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

/** Набор как список «начало строки — классы»: так его и сравнивать. */
function listOf(set: RangeSet<RangeValue>, name: 'class' | 'elementClass'): string[] {
  const out: string[] = [];
  const iter = set.iter();
  while (iter.value !== null) {
    const value = iter.value as unknown as { spec?: { class?: string }; elementClass?: string };
    const text = name === 'class' ? (value.spec?.class ?? '') : (value.elementClass ?? '');
    out.push(`${iter.from} ${text}`);
    iter.next();
  }
  return out;
}

function parsed(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

/**
 * Дерево, разобранное не до конца: CodeMirror разбирает видимое и немного
 * за ним, и без окна состояние стоит на первом куске. Правки — где угодно,
 * и до конца дерева, и за ним; иногда разбор уходит дальше — это своя
 * транзакция без правки текста, после неё поле собирает всё заново.
 */
describe('строки и клетки поля после правки, дерево не до конца', () => {
  for (let seed = 100; seed < 124; seed += 1) {
    it(`правки вразброс, посев ${seed}`, () => {
      const field = blockField(LIST);
      const doc = START.repeat(20);
      let state = EditorState.create({
        doc,
        selection: EditorSelection.cursor(0),
        extensions: [markdownSupport(), field],
      });
      const next = random(seed);
      let partial = 0;

      for (let step = 0; step < 80; step += 1) {
        if (syntaxTree(state).length < state.doc.length) partial += 1;
        // Разбор уходит дальше — то своей транзакцией без правки, то
        // вместе со следующей правкой: в окне бывает и так, когда
        // разобрано меньше видимого.
        if (next() < 0.2) {
          ensureSyntaxTree(state, Math.floor(next() * state.doc.length), 50);
          if (next() < 0.5) state = state.update({}).state;
        }
        const length = state.doc.length;
        const at = Math.floor(next() * (length + 1));
        const change =
          next() < 0.3 && length > 0
            ? { from: at, to: Math.min(length, at + 1 + Math.floor(next() * 30)) }
            : { from: at, insert: PIECES[Math.floor(next() * PIECES.length)]! };
        state = state.update({ changes: change }).state;

        const own = state.field(field).shapes;
        const fresh = blockShapes(state, LIST);
        const where = `шаг ${step}, правка ${JSON.stringify(change)}`;
        expect(listOf(own.lines, 'class'), where).toEqual(listOf(fresh.lines, 'class'));
        expect(listOf(own.gutter, 'elementClass'), where).toEqual(listOf(fresh.gutter, 'elementClass'));
      }
      // Проверка, которая не может провалиться, выглядит как проходящая:
      // дерево и правда было недоразобранным хотя бы часть шагов.
      expect(partial).toBeGreaterThan(10);
    });
  }
});

describe('строки и клетки поля после правки', () => {
  for (let seed = 1; seed <= 24; seed += 1) {
    it(`правки вразброс, посев ${seed}`, () => {
      const field = blockField(LIST);
      let state = parsed(
        EditorState.create({
          doc: START,
          selection: EditorSelection.cursor(START.length),
          extensions: [markdownSupport(), field],
        }),
      );
      const next = random(seed);

      for (let step = 0; step < 80; step += 1) {
        const length = state.doc.length;
        const at = Math.floor(next() * (length + 1));
        const change =
          next() < 0.3 && length > 0
            ? { from: at, to: Math.min(length, at + 1 + Math.floor(next() * 30)) }
            : { from: at, insert: PIECES[Math.floor(next() * PIECES.length)]! };
        state = state.update({ changes: change }).state;

        const own = state.field(field).shapes;
        const fresh = blockShapes(state, LIST);
        const where = `шаг ${step}, правка ${JSON.stringify(change)}`;
        expect(listOf(own.lines, 'class'), where).toEqual(listOf(fresh.lines, 'class'));
        expect(listOf(own.gutter, 'elementClass'), where).toEqual(listOf(fresh.gutter, 'elementClass'));
      }
    });
  }
});
