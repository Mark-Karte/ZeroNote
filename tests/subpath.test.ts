import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';

import { findSubpath, headingForLink, matchHeadings, missingSubpath, splitSubpath } from '../src/editor/subpath';

/**
 * Раздел в ссылке (задача 148). Правила — Obsidian 1.13: ссылки из
 * хранилища, общего с ним, обязаны вести туда же.
 */

const NOTE = [
  '# Проект',
  '',
  '## План',
  '### Итоги: 2026',
  'Текст раздела.',
  '## Отчёт',
  '### Итоги: 2026',
  'Второй раздел с тем же подзаголовком. ^вывод',
  '```',
  '# не заголовок',
  '```',
  '## Быстрая установка',
].join('\n');

const doc = Text.of(NOTE.split('\n'));

/** Номер строки по позиции — так проверять нагляднее. */
function lineOf(subpath: string): number | null {
  const at = findSubpath(doc, subpath);
  return at === null ? null : doc.lineAt(at).number;
}

describe('раздел в ссылке', () => {
  it('заголовок — без учёта регистра и знаков, как у Obsidian', () => {
    expect(lineOf('#План')).toBe(3);
    expect(lineOf('#план')).toBe(3);
    // Двоеточие в ссылку не попадает, сравнение его не замечает.
    expect(lineOf('#Итоги 2026')).toBe(4);
    expect(lineOf('#итоги: 2026')).toBe(4);
  });

  it('вложенный путь различает одинаковые подзаголовки', () => {
    expect(lineOf('#План#Итоги 2026')).toBe(4);
    expect(lineOf('#Отчёт#Итоги 2026')).toBe(7);
    expect(lineOf('#Проект#Отчёт#Итоги 2026')).toBe(7);
  });

  it('метка блока — строка, которая ею кончается', () => {
    // Метка у Obsidian — латиница, цифры и дефис: `^вывод` меткой не считается.
    expect(lineOf('#^вывод')).toBe(null);
    expect(lineOf('#^нет')).toBe(null);
    const withId = Text.of(['Абзац.', 'Строка с меткой ^abc-1', '']);
    const at = findSubpath(withId, '#^ABC-1');
    expect(at === null ? null : withId.lineAt(at).number).toBe(2);
  });

  it('заголовок в блоке кода — не заголовок', () => {
    expect(lineOf('#не заголовок')).toBe(null);
  });

  /** Оглавление README: якорь GitHub — запасным путём. */
  it('якорь GitHub находит заголовок', () => {
    expect(lineOf('#быстрая-установка')).toBe(12);
  });

  it('нет раздела — нет места', () => {
    expect(lineOf('#Нет такого')).toBe(null);
    expect(lineOf('#')).toBe(null);
  });
});

describe('текст ссылки', () => {
  it('путь и раздел', () => {
    expect(splitSubpath('Заметка#План#Итоги')).toEqual({ path: 'Заметка', subpath: '#План#Итоги' });
    expect(splitSubpath('#План')).toEqual({ path: '', subpath: '#План' });
    expect(splitSubpath('Заметка')).toEqual({ path: 'Заметка', subpath: '' });
  });

  it('заголовок для ссылки — без знаков, которые её закрыли бы', () => {
    expect(headingForLink('Итоги: 2026')).toBe('Итоги 2026');
    expect(headingForLink('A | B ^c [[d]] %% e')).toBe('A B c d e');
  });

  it('фраза об отсутствии — по виду раздела', () => {
    expect(missingSubpath('#План#Итоги')).toBe('Заголовка «План#Итоги» в заметке нет');
    expect(missingSubpath('#^вывод')).toBe('Метки «^вывод» в заметке нет');
  });
});

describe('подсказка заголовков', () => {
  const headings = [
    { level: 1, text: 'Проект', from: 0, line: 1 },
    { level: 2, text: 'План работ', from: 10, line: 3 },
    { level: 3, text: 'Итоги: 2026', from: 20, line: 4 },
  ];

  it('по порядку в заметке, пустой запрос — все', () => {
    expect(matchHeadings(headings, '').map((hit) => hit.text)).toEqual(['Проект', 'План работ', 'Итоги: 2026']);
  });

  it('совпадение без учёта регистра, с позициями для подсветки', () => {
    expect(matchHeadings(headings, 'РАБ')).toEqual([{ text: 'План работ', level: 2, matched: [5, 6, 7] }]);
    expect(matchHeadings(headings, 'нет')).toEqual([]);
  });
});
