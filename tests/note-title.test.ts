import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { noteTitle, refreshNoteTitle, renamedFile, titleOf } from '../src/editor/note-title';

/**
 * Имя файла над заметкой (задача 129): что показывается, во что
 * переименовывает правка и когда заголовок перечитывается.
 */

describe('заголовок заметки', () => {
  it('имя файла без расширения', () => {
    expect(titleOf('C:\\Заметки\\Obsidian LiveSync на Proxmox.md')).toBe('Obsidian LiveSync на Proxmox');
    expect(titleOf('C:\\Заметки\\v1.2 план.md')).toBe('v1.2 план');
    expect(titleOf('C:\\Заметки\\.hidden')).toBe('.hidden');
    expect(titleOf('C:\\Заметки\\README')).toBe('README');
    expect(titleOf(null)).toBeNull();
  });

  it('правка заголовка — новое имя с прежним расширением', () => {
    const path = 'C:\\Заметки\\Старое.md';
    expect(renamedFile(path, 'Новое')).toBe('Новое.md');
    expect(renamedFile(path, '  Новое \n имя ')).toBe('Новое имя.md');
    expect(renamedFile(path, 'v1.2')).toBe('v1.2.md');
    // Ничего не поменялось или имя стёрто — переименовывать нечего.
    expect(renamedFile(path, 'Старое')).toBeNull();
    expect(renamedFile(path, ' Старое ')).toBeNull();
    expect(renamedFile(path, '   ')).toBeNull();
  });

  it('заголовок перечитывается только по эффекту', () => {
    let path: string | null = 'C:\\Заметки\\Первое.md';
    const field = noteTitle(() => path, { allowed: () => true, run: async () => {} });
    let state = EditorState.create({ doc: 'Текст.', extensions: field });
    const titles = (current: EditorState): string[] => {
      const out: string[] = [];
      for (const source of current.facet(EditorView.decorations)) {
        const set = typeof source === 'function' ? null : source;
        const iter = set?.iter();
        while (iter && iter.value !== null) {
          const widget = (iter.value.spec as { widget?: { title?: string } }).widget;
          if (widget?.title) out.push(widget.title);
          iter.next();
        }
      }
      return out;
    };

    expect(titles(state)).toEqual(['Первое']);

    // Путь сменился, эффекта не было — заголовок прежний.
    path = 'C:\\Заметки\\Второе.md';
    state = state.update({ changes: { from: 0, insert: 'x' } }).state;
    expect(titles(state)).toEqual(['Первое']);

    state = state.update({ effects: refreshNoteTitle.of(null) }).state;
    expect(titles(state)).toEqual(['Второе']);

    // Файла больше нет у буфера — нет и заголовка.
    path = null;
    state = state.update({ effects: refreshNoteTitle.of(null) }).state;
    expect(titles(state)).toEqual([]);
  });
});
