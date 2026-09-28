/**
 * Типы файлов, которые ZeroNote берётся открывать.
 *
 * Список один на два места: окно выбора файла здесь и «Открыть с помощью»
 * в установщике (`src-tauri/installer/associations.nsh`). Совпадение сторожит
 * `tests/file-types.test.ts`: два списка одного и того же разъезжаются молча,
 * а заметить это можно будет только тогда, когда ZeroNote не найдётся в меню
 * проводника для файла, который окно выбора предлагает открыть.
 *
 * Открывать при этом мы умеем **любой** текстовый файл — список описывает
 * не умение, а то, о чём мы заявляем системе и что предлагаем в диалоге.
 *
 * С задачи 134 здесь всё, что дерево само считает заметкой, кодом
 * и данными (`icons/files.ts`), — у каждого типа свой значок в проводнике
 * (`icons/files/make-file-icons.mjs`). Картинок и PDF здесь нет: см. ниже.
 */

import { t } from '../l10n';

export const TEXT_EXTENSIONS = [
  // Заметки и простой текст.
  'md',
  'markdown',
  'mdx',
  'txt',
  'log',
  // Данные и настройки.
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
  // Код.
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
  'rs',
  'go',
  'swift',
  'py',
  'rb',
  'php',
  'lua',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'svelte',
  'vue',
  'sql',
  'sh',
  'bash',
  'ps1',
  'psm1',
  'bat',
  'cmd',
];

/**
 * Что открывается картинкой, а не текстом.
 *
 * Канонический список — в ядре (`model/buffer.rs`, `IMAGE_EXTENSIONS`): вид
 * вкладки решает оно (Р-180). Здесь копия для фильтра в окне выбора файла,
 * и совпадение сторожит тот же тест, что и список текстовых типов.
 *
 * В установщик картинки не попадают: «Открыть с помощью ZeroNote» для `.png`
 * означало бы соперничество с просмотрщиком фотографий, а мы редактор текста,
 * который умеет показать картинку, — не наоборот.
 */
export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
];

/**
 * Фильтры системного диалога открытия и сохранения. Функцией, а не
 * постоянной: подписи — на языке окна, а он ставится после загрузки модуля.
 */
export function fileFilters(): { name: string; extensions: string[] }[] {
  return [
    { name: t('files.filter.text'), extensions: TEXT_EXTENSIONS },
    { name: t('files.filter.images'), extensions: IMAGE_EXTENSIONS },
    { name: 'PDF', extensions: ['pdf'] },
    { name: t('files.filter.all'), extensions: ['*'] },
  ];
}
