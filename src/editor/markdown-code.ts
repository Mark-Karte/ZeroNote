import { LanguageDescription } from '@codemirror/language';

import { LANGUAGES } from './langs';

/**
 * Языки для блоков кода внутри markdown.
 *
 * Тот же реестр, что и для файлов: блок ```rust подсвечивается ровно так же,
 * как файл `.rs`, и грузится так же — по требованию. Заводить второй список
 * специально для markdown значило бы согласовывать два набора языков.
 *
 * Модуль отдельный, потому что подключается только вместе с markdown:
 * открывшему `.rs` описания языков блоков кода не нужны.
 */
export const languages: LanguageDescription[] = LANGUAGES.map((lang) =>
  LanguageDescription.of({
    name: lang.id,
    // Имена, которыми блок кода подписывают на практике: ```c++, ```sh, ```yml.
    alias: [lang.label.toLowerCase(), ...lang.extensions],
    extensions: lang.extensions,
    load: lang.load,
  }),
);
