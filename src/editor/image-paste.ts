import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/**
 * Вставка картинки из буфера обмена (задача 146).
 *
 * `Ctrl+V` уходит в вебвью (Р-108), и событие вставки несёт то, что лежит
 * в буфере. Текст вставляет CodeMirror, как всегда. Картинку без текста
 * редактор только замечает и отдаёт обработчику: куда класть файл и что
 * вписать в заметку, решают вкладка и ядро.
 */

/** Что делать со вставкой: текст — обычный путь, картинка — наш. */
export type Pasted =
  | { kind: 'text' }
  /**
   * Текста нет. `file` — картинка, которую отдал вебвью; `null` — не отдал,
   * и искать её в буфере будет ядро: вебвью мог не узнать формат, в котором
   * её положила программа.
   */
  | { kind: 'image'; file: File | null };

/**
 * Разобрать содержимое вставки.
 *
 * **Текст побеждает.** Word, Excel и браузер кладут вместе с текстом
 * и картинку того же куска — вставка текстом здесь ожидаемая, так было
 * всегда, и так же у Obsidian. Картинка вставляется, только когда текста
 * нет: снимок экрана, «Копировать изображение».
 */
export function pastedContent(data: Pick<DataTransfer, 'getData' | 'files'>): Pasted {
  if (data.getData('text/plain') !== '') return { kind: 'text' };
  const file = [...data.files].find((item) => item.type.startsWith('image/')) ?? null;
  return { kind: 'image', file };
}

export function imagePaste(onImage: (view: EditorView, file: File | null) => void): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (!event.clipboardData || view.state.readOnly) return false;
      const pasted = pastedContent(event.clipboardData);
      if (pasted.kind === 'text') return false;
      // Текста нет — CodeMirror вставлять нечего, и его обработчик
      // не нужен: дальше вставка наша.
      event.preventDefault();
      onImage(view, pasted.file);
      return true;
    },
  });
}
