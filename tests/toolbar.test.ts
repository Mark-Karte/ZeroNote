import { describe, expect, it } from 'vitest';

import {
  dimmed,
  needOf,
  toolbarShown,
  visibleEntries,
  type ToolbarEntry,
  type ToolbarPlace,
} from '../src/ui/toolbar';

/**
 * Панель инструментов (задача 102): что видно над какой вкладкой.
 *
 * Главное здесь — два разных правила: неприменимое к виду вкладки
 * прячется, неприменимое к состоянию гаснет. И черты, оставшиеся после
 * спрятанных кнопок, не должны висеть в пустоте.
 */

const MARKDOWN: ToolbarPlace = { tab: 'text', markdown: true };
const CODE: ToolbarPlace = { tab: 'text', markdown: false };
const IMAGE: ToolbarPlace = { tab: 'image', markdown: false };
const SETTINGS: ToolbarPlace = { tab: 'settings', markdown: false };

/** Запись панели одной строкой: так ошибка видна сразу. */
function line(entries: ToolbarEntry[]): string {
  return entries
    .map((entry) => {
      switch (entry.kind) {
        case 'command':
          return entry.id;
        case 'separator':
          return '|';
        case 'spacer':
          return '<->';
        case 'path':
          return 'path';
      }
    })
    .join(' ');
}

const SET = [
  'edit.undo',
  'edit.redo',
  'separator',
  'md.bold',
  'md.italic',
  'separator',
  'view.back',
  'spacer',
  'path',
];

describe('панель инструментов', () => {
  it('над markdown показывает всё', () => {
    expect(line(visibleEntries(SET, MARKDOWN))).toBe(
      'edit.undo edit.redo | md.bold md.italic | view.back <-> path',
    );
  });

  it('над кодом прячет разметку и не оставляет двух черт подряд', () => {
    expect(line(visibleEntries(SET, CODE))).toBe('edit.undo edit.redo | view.back <-> path');
  });

  it('над картинкой оставляет только общее для окна', () => {
    expect(line(visibleEntries(SET, IMAGE))).toBe('view.back <-> path');
  });

  it('черта не стоит ни в начале, ни в конце, ни у распорки', () => {
    const items = ['separator', 'md.bold', 'separator', 'spacer', 'separator', 'path', 'separator'];
    expect(line(visibleEntries(items, MARKDOWN))).toBe('md.bold <-> path');
  });

  it('разметка нужна markdown, правка — тексту, прочее — окну', () => {
    expect(needOf('md.bold')).toBe('markdown');
    expect(needOf('view.live-preview')).toBe('markdown');
    expect(needOf('edit.undo')).toBe('text');
    expect(needOf('search.find')).toBe('text');
    expect(needOf('view.fold')).toBe('text');
    expect(needOf('view.back')).toBe('any');
    expect(needOf('file.save')).toBe('any');
    expect(needOf('view.sidebar')).toBe('any');
  });

  it('гаснет то, что сейчас сделать нельзя', () => {
    const nothing = { undo: false, redo: false, back: false, forward: false };
    expect(dimmed('edit.undo', nothing)).toBe(true);
    expect(dimmed('view.forward', nothing)).toBe(true);
    expect(dimmed('md.bold', nothing)).toBe(false);
    expect(dimmed('edit.undo', { ...nothing, undo: true })).toBe(false);
  });

  it('показывается по настройке и никогда — над параметрами', () => {
    expect(toolbarShown('text', CODE)).toBe(true);
    expect(toolbarShown('text', IMAGE)).toBe(false);
    expect(toolbarShown('markdown', CODE)).toBe(false);
    expect(toolbarShown('markdown', MARKDOWN)).toBe(true);
    expect(toolbarShown('always', IMAGE)).toBe(true);
    expect(toolbarShown('always', SETTINGS)).toBe(false);
    expect(toolbarShown('never', MARKDOWN)).toBe(false);
  });
});
