import { describe, expect, it } from 'vitest';
import { notesFor } from '../src/ui/release-notes';

/**
 * Двуязычные заметки к выпуску (задача 156): русская часть, черта,
 * английская. Диалог обновления показывает свою часть.
 */
describe('заметки к выпуску', () => {
  const both = 'Второй язык.\n\nАнглийское окно.\n\n---\n\nSecond language.\n\nEnglish window.\n';

  it('русскому окну — русская часть, прочим — английская', () => {
    expect(notesFor(both, 'ru')).toBe('Второй язык.\n\nАнглийское окно.');
    expect(notesFor(both, 'en')).toBe('Second language.\n\nEnglish window.');
    // Свой перевод — английская часть: русской он не читает.
    expect(notesFor(both, 'de')).toBe('Second language.\n\nEnglish window.');
    expect(notesFor(both, 'ru-RU')).toBe('Второй язык.\n\nАнглийское окно.');
  });

  it('заметки прежних выпусков — целиком', () => {
    expect(notesFor('Привычные движения.\n\nКартинка из буфера.', 'en')).toBe(
      'Привычные движения.\n\nКартинка из буфера.',
    );
  });

  it('черта — только отдельной строкой, и переносы Windows тоже', () => {
    // Тире внутри текста разделителем не считается.
    expect(notesFor('Было — стало --- и дальше', 'en')).toBe('Было — стало --- и дальше');
    expect(notesFor('Русский.\r\n\r\n-----\r\n\r\nEnglish.', 'en')).toBe('English.');
  });
});
