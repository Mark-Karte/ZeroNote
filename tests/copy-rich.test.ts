import { describe, expect, it } from 'vitest';

import { opaque, pickText, styleFor, textStyle } from '../src/export/copy';

/**
 * Копировать с оформлением (задача 112): что из вычисленного стиля
 * попадает в буфер. Сам каскад считает браузер — проверяется глазами,
 * вставкой в Word; здесь решение «писать или нет».
 */

const BASE = {
  color: 'rgb(31, 35, 40)',
  'font-family': '"IBM Plex Sans", sans-serif',
  'font-size': '14px',
  'font-style': 'normal',
  'font-weight': '400',
  'text-align': 'start',
  'list-style-type': 'disc',
  'background-color': 'rgba(0, 0, 0, 0)',
  'text-decoration-line': 'none',
  'border-radius': '0px',
  'padding-top': '0px',
  'padding-right': '0px',
  'padding-bottom': '0px',
  'padding-left': '0px',
  'vertical-align': 'baseline',
  'white-space': 'normal',
  'border-top-style': 'none',
  'border-top-width': '0px',
  'border-top-color': 'rgb(31, 35, 40)',
  'border-right-style': 'none',
  'border-right-width': '0px',
  'border-right-color': 'rgb(31, 35, 40)',
  'border-bottom-style': 'none',
  'border-bottom-width': '0px',
  'border-bottom-color': 'rgb(31, 35, 40)',
  'border-left-style': 'none',
  'border-left-width': '0px',
  'border-left-color': 'rgb(31, 35, 40)',
};

describe('стиль для вставки', () => {
  /** Текст вливается в чужой документ: то, что не отличается, не пишется. */
  it('обычный абзац — без стиля вовсе', () => {
    expect(styleFor(BASE, BASE)).toBe('');
  });

  /** Word знает «жирный» и «обычный», а 600 читал как обычный. */
  it('заголовок — размер и вес словом, отличные от родителя', () => {
    const heading = { ...BASE, 'font-size': '21px', 'font-weight': '600' };
    expect(styleFor(heading, BASE)).toBe('font-size: 21px; font-weight: bold');
  });

  it('код — шрифт, подложка и перенос строк', () => {
    const pre = {
      ...BASE,
      'font-family': '"JetBrains Mono", monospace',
      'background-color': 'rgba(63, 99, 135, 0.08)',
      'white-space': 'pre-wrap',
      'padding-left': '12px',
    };
    expect(styleFor(pre, BASE)).toBe(
      'font-family: "JetBrains Mono", monospace; white-space: pre-wrap; ' +
        'background-color: rgb(240, 243, 245); padding-left: 12px',
    );
  });

  /** Кусочек раскраски внутри кода наследует перенос — повторять его незачем. */
  it('наследуемое у ребёнка не повторяется', () => {
    const pre = { ...BASE, 'white-space': 'pre-wrap', 'font-family': 'monospace' };
    const token = { ...pre, color: 'rgb(207, 34, 46)' };
    expect(styleFor(token, pre)).toBe('color: rgb(207, 34, 46)');
  });

  /** Word понимает `text-decoration`, а не его части. */
  it('зачёркнутое — одним свойством `text-decoration`', () => {
    expect(styleFor({ ...BASE, 'text-decoration-line': 'line-through' }, BASE)).toBe(
      'text-decoration: line-through',
    );
  });

  it('рамка — только у сторон, где она есть', () => {
    const quote = {
      ...BASE,
      'border-left-style': 'solid',
      'border-left-width': '2px',
      'border-left-color': 'rgb(130, 80, 223)',
    };
    expect(styleFor(quote, BASE)).toBe('border-left: 2px solid rgb(130, 80, 223)');
  });
});

describe('что понимает Word (найдено вставкой)', () => {
  /** `rgba()` Word выбрасывает молча — подложки пропадали. */
  it('полупрозрачный цвет — непрозрачным над белым листом', () => {
    expect(opaque('rgba(9, 105, 218, 0.1)')).toBe('rgb(230, 240, 251)');
    expect(opaque('rgba(0, 0, 0, 0.5)')).toBe('rgb(128, 128, 128)');
    expect(opaque('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(opaque('underline')).toBe('underline');
  });

  it('подложка в стиле — уже непрозрачная', () => {
    expect(styleFor({ ...BASE, 'background-color': 'rgba(9, 105, 218, 0.1)' }, BASE)).toBe(
      'background-color: rgb(230, 240, 251)',
    );
  });

  /** Без шрифта на обёртке Word читает HTML шрифтом Times New Roman. */
  it('обёртка несёт шрифт, размер и цвет текста', () => {
    expect(textStyle(BASE)).toBe(
      'font-family: "IBM Plex Sans", sans-serif; font-size: 14px; color: rgb(31, 35, 40)',
    );
  });
});

describe('что копируется', () => {
  it('без выделения — весь текст', () => {
    expect(pickText('abc', [{ from: 1, to: 1 }])).toEqual({ text: 'abc', whole: true });
  });

  it('выделение — оно, несколько — через перевод строки', () => {
    expect(pickText('abcdef', [{ from: 0, to: 2 }])).toEqual({ text: 'ab', whole: false });
    expect(pickText('abcdef', [{ from: 0, to: 2 }, { from: 3, to: 3 }, { from: 4, to: 6 }])).toEqual({
      text: 'ab\nef',
      whole: false,
    });
  });
});
