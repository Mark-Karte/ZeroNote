/**
 * Номера строк: где они показываются (задача 80, Р-213).
 *
 * Чистое правило отдельным модулем — как читаемая ширина в `readable.ts`.
 * Правило короткое, но держится на решении, которое иначе пришлось бы
 * вспоминать по коду компонента.
 */

/** Значение настройки `[editor] line_numbers`. */
export type LineNumbersSetting = 'always' | 'never' | 'code';

export interface LineNumbersContext {
  setting: LineNumbersSetting;
  /** Markdown ли на вкладке: только его мы считаем прозой. */
  markdown: boolean;
}

/**
 * Показывать ли номера строк на этой вкладке.
 *
 * **Прозой считается только markdown** (Р-214), и отсечение идёт по языку,
 * как у читаемой ширины (Р-156). Файл без языка — `.txt`, безымянный буфер,
 * незнакомое расширение — номера сохраняет: чаще всего это лог или
 * вставленный кусок кода, где номер и нужен, а угадывать «заметка это
 * или нет» по отсутствию расширения мы не беремся.
 *
 * Спрятанный номер не убирает поле: закладка остаётся на своём месте,
 * свёртка — на своём. Это делает `lineNumbersExtension` в `setup.ts`,
 * здесь решается только «да или нет».
 */
export function lineNumbersOn(ctx: LineNumbersContext): boolean {
  switch (ctx.setting) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'code':
      return !ctx.markdown;
  }
}

/**
 * Значение настройки из файла — в то, что понимает правило.
 *
 * Незнакомое здесь превращается в умолчание молча, и это не поблажка:
 * громко на него уже ответило ядро — разбор `settings.toml` называет
 * и ключ, и допустимые значения, и показывает это полосой предупреждений.
 * Второй раз ту же беду объявлять некому.
 */
export function lineNumbersSettingOf(value: string | undefined): LineNumbersSetting {
  return value === 'always' || value === 'never' ? value : 'code';
}
