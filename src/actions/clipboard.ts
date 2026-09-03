import { message } from '@tauri-apps/plugin-dialog';
import type { EditorView } from '@codemirror/view';
import { copiedText, pasteSpec } from '../editor/clipboard';
import { clipboardText } from '../ipc/clipboard';

/**
 * Работа с буфером обмена — со стороны действий.
 *
 * Клавиши `Ctrl+X`, `Ctrl+C` и `Ctrl+V` в области текста и в полях ввода
 * обслуживает вебвью, и мы их не перехватываем (Р-108). Здесь то же самое
 * для пунктов меню и для случая, когда сочетание переназначили в
 * `keymap.toml`.
 */

/**
 * Текст, скопированный целыми строками в последний раз.
 *
 * По нему вставка узнаёт, что вставлять надо тоже строками — перед текущей,
 * а не в середину слова под курсором. Так же устроено и в CodeMirror.
 *
 * Своя память, а не его: у CodeMirror она внутренняя и наружу не выведена.
 * Отсюда единственное расхождение: строка, скопированная клавишей `Ctrl+C`
 * и вставленная пунктом меню, встанет в позицию курсора, а не перед строкой.
 * Обратный порядок — тем же изъяном наоборот. Лечится это только доступом
 * к внутренностям чужой библиотеки, что дороже самого изъяна.
 */
let lastLinewise: string | null = null;

/** Положить строку в буфер обмена. Возвращает `false`, если не вышло. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    await message(`Не удалось записать в буфер обмена.\n\n${String(error)}`, {
      title: 'ZeroNote',
      kind: 'error',
    });
    return false;
  }
}

/**
 * Взять строку из буфера обмена. `null` — не вышло, и об этом уже сказано.
 *
 * Через ядро, а не через `navigator.clipboard.readText()`, и это измерено,
 * а не предположено: в нашем WebView2 браузерное чтение **не отвечает вовсе** —
 * ни ответа, ни ошибки, обещание висит вечно (Р-109). Худший вид отказа:
 * пункт «Вставить» молча не делал бы ничего, и ветка ошибки никогда бы
 * не сработала.
 *
 * Запись при этом остаётся браузерной: она работает и лишнего перехода
 * через ядро не требует.
 */
export async function readText(): Promise<string | null> {
  try {
    return await clipboardText();
  } catch (error) {
    await message(`Не удалось прочитать буфер обмена.\n\n${String(error)}`, {
      title: 'ZeroNote',
      kind: 'error',
    });
    return null;
  }
}

export async function copySelection(view: EditorView): Promise<void> {
  const copied = copiedText(view.state);
  if (!(await copyText(copied.text))) return;
  lastLinewise = copied.linewise ? copied.text : null;
}

export async function cutSelection(view: EditorView): Promise<void> {
  if (view.state.readOnly) return;

  const copied = copiedText(view.state);
  // Сначала в буфер, потом резать: если запись не удалась, текст должен
  // остаться на месте. Иначе выйдет удаление, названное вырезанием.
  if (!(await copyText(copied.text))) return;
  lastLinewise = copied.linewise ? copied.text : null;
  view.dispatch(copied.cut);
}

export async function pasteIntoEditor(view: EditorView): Promise<void> {
  if (view.state.readOnly) return;

  const text = await readText();
  if (text === null || text === '') return;
  view.dispatch(pasteSpec(view.state, text, text === lastLinewise));
}

/** Поле ввода — панель поиска, палитра, диалог. */
export type Field = HTMLInputElement | HTMLTextAreaElement;

export function isField(target: EventTarget | null): target is Field {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function fieldSelection(field: Field): string {
  return field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
}

export async function copyField(field: Field): Promise<void> {
  const text = fieldSelection(field);
  if (text) await copyText(text);
}

export async function cutField(field: Field): Promise<void> {
  const text = fieldSelection(field);
  if (!text || field.readOnly) return;
  if (!(await copyText(text))) return;
  replaceInField(field, '');
}

export async function pasteField(field: Field): Promise<void> {
  if (field.readOnly) return;
  const text = await readText();
  if (text === null || text === '') return;
  replaceInField(field, text);
}

export function selectAllField(field: Field): void {
  field.select();
}

/**
 * Заменить выделенное в поле.
 *
 * Событие `input` посылается вручную: `setRangeText` его не порождает,
 * а без него привязка Svelte не узнает о новом значении — поле показывало бы
 * вставленное, а состояние осталось бы прежним.
 */
function replaceInField(field: Field, text: string): void {
  field.focus();
  field.setRangeText(text, field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
