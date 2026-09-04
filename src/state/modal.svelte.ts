/**
 * Собственные модальные вопросы.
 *
 * Системный диалог Tauri умеет только два ответа — «да» и «отмена». Нам нужны
 * вопросы с тремя и более вариантами: к какому типу переносов привести файл,
 * что делать с изменившимся на диске файлом. Отсюда свой диалог.
 *
 * Заодно он выглядит по теме приложения, а не системным окном поверх
 * оформленного интерфейса.
 *
 * Устроено так, чтобы вопрос можно было задать из обычного кода в `actions/`,
 * а не только из компонента: функция возвращает обещание, которое разрешается,
 * когда пользователь выбрал.
 */

export interface Choice {
  id: string;
  label: string;
  /** Вариант по умолчанию: он получает фокус и срабатывает по Enter. */
  primary?: boolean;
  /** Отмена: срабатывает по Escape и при закрытии диалога. */
  cancel?: boolean;
  /**
   * Необратимый вариант: «не сохранять», «потерять правки».
   *
   * Помечается цветом опасности. Ради этого диалог и написан свой (Р-027):
   * в системном такой вариант неотличим от обычного, и нажать его случайно
   * стоит ровно тех данных, которые пользователь набирал.
   */
  danger?: boolean;
}

export interface ModalRequest {
  title: string;
  text: string;
  choices: Choice[];
  /** Диалог с полем ввода: ответом становится введённая строка. */
  input?: { initial: string } | undefined;
  resolve: (id: string | null) => void;
}

export const modal = $state<{ request: ModalRequest | null }>({ request: null });

/**
 * Задать вопрос и дождаться ответа.
 *
 * Возвращает `null`, если пользователь отказался. Вызывающий код обязан
 * это учитывать: «отмена» никогда не должна означать «сделай хоть что-нибудь».
 */
export function askChoice(
  title: string,
  text: string,
  choices: Choice[],
): Promise<string | null> {
  return open({ title, text, choices });
}

/**
 * Спросить строку.
 *
 * Возвращает введённое или `null`, если пользователь отказался.
 *
 * Подпись кнопки задаётся вызывающим и не имеет умолчания по смыслу:
 * «Перейти», «Создать» и «Переименовать» — разные обещания, и одно вместо
 * другого читается как ошибка. Первая версия подписывала кнопку «Перейти»
 * всегда, потому что первым её позвал переход к строке.
 */
export function askInput(
  title: string,
  text: string,
  initial: string,
  confirm: string,
): Promise<string | null> {
  return open({
    title,
    text,
    input: { initial },
    choices: [
      { id: 'cancel', label: 'Отмена', cancel: true },
      { id: 'ok', label: confirm, primary: true },
    ],
  });
}

function open(request: Omit<ModalRequest, 'resolve'>): Promise<string | null> {
  // Два вопроса одновременно — ошибка в вызывающем коде, но подвесить
  // предыдущее обещание навсегда всё равно нельзя.
  modal.request?.resolve(null);

  return new Promise((resolve) => {
    modal.request = {
      ...request,
      resolve: (value) => {
        modal.request = null;
        resolve(value);
      },
    };
  });
}
