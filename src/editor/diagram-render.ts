import mermaid from 'mermaid';

/**
 * Текст схемы → SVG: отдельный модуль ради одного — грузиться по требованию.
 *
 * mermaid — самая крупная зависимость проекта, вдвое больше pdf.js
 * (раздел 42, «Цена — измерена»), и в стартовый кусок ему незачем:
 * схемы есть не в каждой заметке. `editor/diagram.ts` зовёт этот модуль
 * через `import()` при первой схеме на экране, как pdf.js (Р-181).
 */

/** Цвета и шрифт схемы — значения токенов темы, уже вычисленные. */
export interface DiagramTheme {
  dark: boolean;
  fontFamily: string;
  fontSize: string;
  background: string;
  node: string;
  nodeBorder: string;
  text: string;
  line: string;
  secondary: string;
  tertiary: string;
  cluster: string;
  clusterBorder: string;
  note: string;
}

let counter = 0;

/**
 * Очередь: схемы рисуются по одной. У mermaid настройка общая на всё
 * окно (`initialize`), и две отрисовки вперемешку взяли бы чужую тему.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Нарисовать схему. Бросает ошибку разбора — её текст покажет виджет.
 *
 * Заметка чужая (Р-202), поэтому `securityLevel: 'strict'`: без
 * обработчиков щелчков, HTML в подписях чистит DOMPurify. В сеть mermaid
 * сам не ходит, а если бы пошёл — окно не пустит (`connect-src ipc:`).
 */
export function renderDiagram(source: string, theme: DiagramTheme): Promise<string> {
  const run = async (): Promise<string> => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // Ошибку разбора mermaid иначе рисует своей картинкой прямо в окне;
      // нам нужен её текст, а не картинка.
      suppressErrorRendering: true,
      theme: 'base',
      darkMode: theme.dark,
      fontFamily: theme.fontFamily,
      themeVariables: {
        darkMode: theme.dark,
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSize,
        background: theme.background,
        primaryColor: theme.node,
        primaryBorderColor: theme.nodeBorder,
        primaryTextColor: theme.text,
        nodeBorder: theme.nodeBorder,
        mainBkg: theme.node,
        textColor: theme.text,
        lineColor: theme.line,
        secondaryColor: theme.secondary,
        tertiaryColor: theme.tertiary,
        clusterBkg: theme.cluster,
        clusterBorder: theme.clusterBorder,
        edgeLabelBackground: theme.background,
        noteBkgColor: theme.note,
        noteTextColor: theme.text,
        noteBorderColor: theme.clusterBorder,
      },
    });
    counter += 1;
    const { svg } = await mermaid.render(`zn-diagram-${counter}`, source);
    return svg;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
