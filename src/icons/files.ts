import type { IconName } from './registry';

/**
 * Значок по имени файла.
 *
 * Набор намеренно грубый: заметка, код, всё остальное. Значок на каждый язык —
 * это отдельный набор иконок, который придётся сопровождать; пользы от него
 * меньше, чем кажется, а веса он добавляет заметно.
 */

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
  'hpp',
  'cs',
  'java',
  'kt',
  'rb',
  'php',
  'lua',
  'sh',
  'ps1',
  'bat',
  'cmd',
  'html',
  'css',
  'scss',
  'svelte',
  'vue',
  'sql',
  'toml',
  'json',
  'yaml',
  'yml',
  'xml',
  'ini',
]);

const MARKDOWN = new Set(['md', 'markdown', 'mdx']);

export function iconForFile(name: string): IconName {
  const dot = name.lastIndexOf('.');
  // Файл без расширения либо начинающийся с точки — `.gitignore`, `LICENSE`.
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';

  if (MARKDOWN.has(ext)) return 'file.markdown';
  if (CODE.has(ext)) return 'file.code';
  return 'file.text';
}
