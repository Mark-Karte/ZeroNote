import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

/**
 * Имя файла заголовком над заметкой (задача 129), как у Obsidian.
 *
 * Заголовок — не текст файла: это его имя, и правка заголовка —
 * переименование файла тем же путём, что в дереве, — со списком ссылок
 * до записи (Р-136) и вопросом, обновлять ли их. Щелчок — и имя
 * правится прямо на месте; `Enter` или уход фокуса — переименовать,
 * `Escape` — вернуть как было.
 *
 * Виджет над первой строкой, а не элемент окна над редактором: так
 * заголовок прокручивается вместе с текстом, как у Obsidian. Блочный
 * виджет CodeMirror принимает только от поля состояния (Р-203), поэтому
 * имя живёт в поле; меняется оно по эффекту `refreshNoteTitle`, который
 * шлёт вкладка, когда у неё сменился путь, — переименование, «сохранить
 * как», перенос папки.
 *
 * Правки и выделение внутри виджета CodeMirror не видит: `ignoreEvent`
 * отдаёт ему «не моё», а у поля ввода своё выделение, и ни набор,
 * ни выделение в заголовке документ не трогают.
 */

/** Имя без папки. */
function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1);
}

/** Заголовок заметки: имя файла без расширения; `null` — файла у буфера нет. */
export function titleOf(path: string | null): string | null {
  if (path === null) return null;
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Новое имя файла из набранного в заголовке. Расширение — прежнее:
 * заголовок его не показывает, и потерять его правкой заголовка нельзя.
 * Переносы строк и повторные пробелы — одним пробелом: имя файла в одну
 * строку. `null` — переименовывать нечего.
 */
export function renamedFile(path: string, typed: string): string | null {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  const base = typed.replace(/\s+/g, ' ').trim();
  if (base === '') return null;
  const next = base + extension;
  return next === name ? null : next;
}

/** Путь буфера сменился — перечитать заголовок. */
export const refreshNoteTitle = StateEffect.define<null>();

/**
 * Переименование из заголовка — снаружи: редактор не знает ни про дерево,
 * ни про ссылки в других файлах.
 */
export interface TitleRename {
  /**
   * Можно ли переименовать файл: он внутри открытой папки. Спрашивается
   * при наведении и фокусе, а не при создании заголовка, — папку могли
   * открыть или закрыть с тех пор.
   */
  allowed: () => boolean;
  /** Набранное в заголовке — переименовать файл. */
  run: (typed: string) => Promise<void>;
}

class TitleWidget extends WidgetType {
  constructor(
    readonly title: string,
    readonly rename: TitleRename,
  ) {
    super();
  }

  override eq(other: TitleWidget): boolean {
    return other.title === this.title;
  }

  override toDOM(view: EditorView): HTMLElement {
    // Поле ввода, а не область правки (`contenteditable`) внутри текста:
    // вложенная в CodeMirror область делит с ним выделение, и `Ctrl+A`
    // браузера в ней выделял всю заметку — набор уходил в текст (найдено
    // на живом окне). У поля своё выделение и своя вставка — только
    // текстом. Многострочное — ради переноса длинного имени; высоту
    // задаёт содержимое (`field-sizing` в `editor.css`).
    const box = document.createElement('div');
    const field = document.createElement('textarea');
    field.className = 'zn-note-title';
    field.rows = 1;
    field.spellcheck = false;
    field.value = this.title;
    box.append(field);

    // Файл вне открытых папок ядро не переименует (`inside_root`), и поле
    // не предлагает правку, которая заведомо кончится отказом: имя видно,
    // выделяется и копируется, но не правится.
    const sync = (): void => {
      const allowed = this.rename.allowed();
      field.readOnly = !allowed;
      field.title = allowed ? '' : 'Файл вне открытых папок: переименовать можно, открыв его папку';
    };
    sync();
    field.addEventListener('pointerenter', sync);
    field.addEventListener('focus', sync);

    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        view.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        field.value = this.title;
        view.focus();
      }
    });

    // Переименование — когда фокус ушёл: по `Enter` или щелчком в текст.
    // Что бы ни вышло — отказ ядра, «Отмена» в вопросе про ссылки, — этот
    // заголовок возвращает прежнее имя; удалось — поле пришлёт новый.
    field.addEventListener('blur', () => {
      // Окно ушло на задний план — это не конец правки: фокус вернётся
      // в заголовок вместе с окном, а вопрос про ссылки посреди чужого
      // окна был бы непрошеным.
      if (!document.hasFocus()) return;
      const typed = field.value;
      if (typed.replace(/\s+/g, ' ').trim() === this.title) {
        field.value = this.title;
        return;
      }
      void this.rename.run(typed).finally(() => {
        field.value = this.title;
      });
    });

    return box;
  }

  /** Всё внутри заголовка — его: CodeMirror не ставит курсор и не читает правку. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Заголовок над заметкой. Путь — функцией, как у превью картинок:
 * «сохранить как» и переименование меняют его без пересоздания состояния.
 */
export function noteTitle(sourcePath: () => string | null, rename: TitleRename): Extension {
  return StateField.define<string | null>({
    create: () => titleOf(sourcePath()),
    update(value, tr) {
      return tr.effects.some((effect) => effect.is(refreshNoteTitle)) ? titleOf(sourcePath()) : value;
    },
    provide: (field) =>
      EditorView.decorations.from(field, (title) =>
        title === null
          ? Decoration.none
          : Decoration.set([
              Decoration.widget({ widget: new TitleWidget(title, rename), block: true, side: -1 }).range(0),
            ]),
      ),
  });
}
