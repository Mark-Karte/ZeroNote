import { describe, expect, it } from 'vitest';
import { kindOf, iconForKind } from '../src/icons/files';

describe('вид файла по имени', () => {
  it('markdown — заметка', () => {
    expect(kindOf('идея.md')).toBe('note');
    expect(kindOf('README.markdown')).toBe('note');
  });

  it('исходники — код', () => {
    expect(kindOf('main.rs')).toBe('code');
    expect(kindOf('EditorHost.svelte')).toBe('code');
    expect(kindOf('draw.cpp')).toBe('code');
  });

  it('настройки и данные — отдельный вид', () => {
    expect(kindOf('zeronote.toml')).toBe('data');
    expect(kindOf('package.json')).toBe('data');
  });

  it('регистр расширения роли не играет', () => {
    expect(kindOf('ЗАМЕТКА.MD')).toBe('note');
    expect(kindOf('Main.RS')).toBe('code');
  });

  it('точка в начале имени — не расширение', () => {
    // `.gitignore` — файл без расширения. Иначе он оказался бы файлом
    // с расширением «gitignore» и попал в «прочее» по случайности,
    // а не по правилу.
    expect(kindOf('.gitignore')).toBe('other');
    expect(kindOf('.env')).toBe('other');
  });

  it('незнакомое и безрасширенное — прочее', () => {
    expect(kindOf('заметки.log')).toBe('other');
    expect(kindOf('LICENSE')).toBe('other');
  });

  it('расширение берётся последнее', () => {
    expect(kindOf('архив.tar.gz')).toBe('other');
    expect(kindOf('стиль.module.css')).toBe('code');
  });

  it('код и данные делят значок, различает их цвет', () => {
    expect(iconForKind('code')).toBe(iconForKind('data'));
    expect(iconForKind('note')).not.toBe(iconForKind('code'));
  });
});
