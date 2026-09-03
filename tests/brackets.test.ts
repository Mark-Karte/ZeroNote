import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EditorState, type Extension } from '@codemirror/state';
import { brackets, matchingPosition } from '../src/editor/brackets';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Переход к парной скобке.
 *
 * Сопоставление делает CodeMirror, наше здесь — выбор скобки под курсором
 * и место, куда встанет курсор. Именно это и проверяется: «вправо, потом
 * влево» — правило, которое легко переставить местами и не заметить.
 */

function at(doc: string, cursor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: cursor } });
}

describe('переход к парной скобке', () => {
  it('от открывающей — за закрывающую', () => {
    // Курсор перед «(» на позиции 2; «)» стоит на 5, курсор встаёт за неё.
    expect(matchingPosition(at('a (bc) d', 2))).toBe(6);
  });

  it('от закрывающей — перед открывающую', () => {
    // Курсор сразу после «)»: смотрим влево и встаём перед «(».
    expect(matchingPosition(at('a (bc) d', 6))).toBe(2);
  });

  /**
   * Главное свойство: переход — качели. Одно и то же нажатие уводит туда
   * и возвращает обратно. Встань курсор внутрь пары, второе нажатие
   * не нашло бы рядом скобки вовсе.
   */
  it('возвращает обратно повторным переходом', () => {
    const doc = 'a (bc) d';
    const there = matchingPosition(at(doc, 2))!;
    expect(matchingPosition(at(doc, there))).toBe(2);
  });

  /**
   * Курсор внутри только что набранной пары — самый частый случай из всех:
   * скобка закрылась сама, и курсор остался между ними.
   */
  it('работает изнутри пары', () => {
    expect(matchingPosition(at('a () d', 3))).toBe(4);
  });

  /**
   * Между двумя открывающими побеждает та, что перед курсором, — ровно как
   * в подсветке. Расхождение здесь означало бы «подсвечено одно, перешли
   * к другому».
   */
  it('разбирается во вложенности', () => {
    expect(matchingPosition(at('((a))', 0))).toBe(5);
    expect(matchingPosition(at('((a))', 1))).toBe(5);
    expect(matchingPosition(at('((a))', 2))).toBe(4);
  });

  it('молчит там, где скобки нет', () => {
    expect(matchingPosition(at('просто текст', 3))).toBeNull();
  });

  /** Скобка без пары — не повод прыгать наугад: подсветка покажет её красным. */
  it('молчит у скобки без пары', () => {
    expect(matchingPosition(at('a (bc d', 2))).toBeNull();
  });

  it('работает с квадратными и фигурными', () => {
    expect(matchingPosition(at('[a]', 0))).toBe(3);
    expect(matchingPosition(at('{a}', 0))).toBe(3);
  });
});

describe('что закрывается само', () => {
  /**
   * `insertBracket` — то самое, что вызывает `closeBrackets` на каждый набранный
   * знак. `null` означает «ничего особенного не делаем», то есть знак просто
   * вставится как есть, без пары.
   */
  async function closes(bracket: string, extensions: Extension = []): Promise<boolean> {
    const { insertBracket } = await import('@codemirror/autocomplete');
    const { closeBrackets } = await import('@codemirror/autocomplete');
    const state = EditorState.create({
      doc: '',
      extensions: [closeBrackets(), brackets(), extensions],
    });
    return insertBracket(state, bracket) !== null;
  }

  /** Проза — это текст без языка: `.txt`, новый буфер, чужое расширение. */
  it('в прозе закрывает скобки, но не кавычки', async () => {
    expect(await closes('(')).toBe(true);
    expect(await closes('[')).toBe(true);
    // «Сказал» — не начало строкового литерала.
    expect(await closes('"')).toBe(false);
    expect(await closes("'")).toBe(false);
  });

  it('в markdown так же: скобки да, кавычки нет', async () => {
    const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown');
    const md = markdown({ base: markdownLanguage });
    const prose = [
      md,
      md.language.data.of({ closeBrackets: { brackets: ['(', '[', '{'] } }),
    ];

    expect(await closes('[', prose)).toBe(true);
    expect(await closes('"', prose)).toBe(false);
  });

  /** А в коде кавычка как раз парная, и закрывать её надо. */
  it('в коде закрывает и кавычки', async () => {
    const { rust } = await import('@codemirror/lang-rust');
    expect(await closes('"', rust())).toBe(true);
    expect(await closes('(', rust())).toBe(true);
  });
});

/**
 * Закрытие скобок взято из пакета `@codemirror/autocomplete`, и это единственное,
 * что из него берётся. Автодополнение остаётся вне области первого круга,
 * а «пакет уже в зависимостях» — самый лёгкий путь к тому, чтобы оно там
 * однажды оказалось. Поэтому граница стережётся тестом, а не памятью.
 */
describe('граница пакета автодополнения', () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        sources(path, out);
      } else if (/\.(ts|svelte)$/.test(name)) {
        out.push(path);
      }
    }
    return out;
  }

  it('из пакета берётся только закрытие скобок', () => {
    const allowed = new Set(['closeBrackets', 'closeBracketsKeymap']);
    const used = new Set<string>();

    for (const file of sources(join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*'@codemirror\/autocomplete'/g,
      )) {
        for (const name of match[1]!.split(',')) {
          const clean = name.trim();
          if (clean) used.add(clean);
        }
      }
    }

    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((name) => !allowed.has(name))).toEqual([]);
  });

  it('автодополнение не включено нигде', () => {
    const offenders = sources(join(root, 'src')).filter((file) =>
      /\bautocompletion\s*\(/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
