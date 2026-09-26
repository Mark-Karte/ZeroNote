import temml from 'temml';
import 'temml/dist/Temml-Local.css';

/**
 * TeX → MathML: отдельный модуль ради одного — грузиться по требованию.
 *
 * Temml весит около двухсот килобайт, и в стартовый кусок ему незачем:
 * формулы есть не в каждой заметке. `editor/math.ts` зовёт этот модуль
 * через `import()` при первой формуле на экране, как pdf.js (Р-181).
 * Таблица стилей Temml едет в тот же кусок: без неё Chromium не выравнивает
 * столбцы `aligned` (раздел 42, «Что известно заранее»).
 *
 * MathML рисует сам движок окна шрифтом Cambria Math — своих шрифтов
 * формул у нас нет (Р-276).
 */

/**
 * Разметка MathML для формулы. Бросает `ParseError` на неразборчивом TeX.
 *
 * `trust: false` — явно, хотя это и умолчание: заметка чужая (Р-202),
 * и `\href` или `\htmlClass` из неё исполняться не должны.
 */
export function toMathML(tex: string, display: boolean): string {
  return temml.renderToString(tex, { displayMode: display, throwOnError: true, trust: false });
}
