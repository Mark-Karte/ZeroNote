import type { IconName } from './registry';

/**
 * Вид файла по имени — от него зависят и значок, и его цвет.
 *
 * Набор намеренно грубый: заметка, код, данные, всё остальное. Значок на каждый
 * язык — это отдельный набор иконок, который придётся сопровождать; пользы
 * от него меньше, чем кажется, а веса он добавляет заметно. Цвет метки задаёт
 * тема ролями `color-file-*`, и оттенок на каждое расширение означал бы, что
 * автор темы обязан знать языки, а мы — править все темы при добавлении нового.
 *
 * Это не то же самое, что язык подсветки (`editor/langs.ts`). Там важно, каким
 * парсером разбирать файл; здесь — как он выглядит в списке. У подсветки
 * двадцать языков и ни одного ответа на вопрос «а какого цвета `.log`».
 */

export type FileKind = 'note' | 'code' | 'data' | 'other';

/** Заметки: то, ради чего в редакторе есть связи и обратные ссылки. */
const NOTE = new Set(['md', 'markdown', 'mdx']);

/** Исходный код. */
const CODE = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'rs',
  'py',
  'go',
  'c',
  'h',
  'cpp',
  'cxx',
  'cc',
  'hpp',
  'hxx',
  'cs',
  'java',
  'kt',
  'rb',
  'php',
  'lua',
  'swift',
  'sh',
  'bash',
  'ps1',
  'psm1',
  'bat',
  'cmd',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'svelte',
  'vue',
  'sql',
]);

/** Данные и настройки: то, что читает программа, а не человек. */
const DATA = new Set([
  'toml',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'xml',
  'ini',
  'cfg',
  'conf',
  'csv',
  'tsv',
  'properties',
  'lock',
]);

/**
 * Расширение в нижнем регистре, без точки. Пустая строка — расширения нет.
 *
 * Точка в начале имени расширением не считается: `.gitignore` — это файл
 * без расширения, а не файл с расширением «gitignore».
 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function kindOf(name: string): FileKind {
  const ext = extensionOf(name);
  if (NOTE.has(ext)) return 'note';
  if (CODE.has(ext)) return 'code';
  if (DATA.has(ext)) return 'data';
  return 'other';
}

/**
 * Значок для вида файла.
 *
 * Данные и код делят одну форму: различает их цвет. Своя форма понадобилась бы,
 * только если бы цвет был недоступен, а он часть темы и есть всегда.
 */
export function iconForKind(kind: FileKind): IconName {
  switch (kind) {
    case 'note':
      return 'file.markdown';
    case 'code':
    case 'data':
      return 'file.code';
    default:
      return 'file.text';
  }
}

export function iconForFile(name: string): IconName {
  return iconForKind(kindOf(name));
}
