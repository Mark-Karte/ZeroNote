/**
 * Строки интерфейса на языке человека (задача 152, Р-314).
 *
 * Таблица — файл на язык в `l10n/` в корне репозитория: плоский JSON,
 * ключ — область и смысл через точку (`status.words`), значение — строка
 * или формы числа. Та же таблица у ядра: оно вшивает её в себя и пишет
 * свои сообщения по тем же правилам.
 *
 * Язык один на всё время работы окна: ядро выбирает его при старте
 * (`language` в `[appearance]`), смена — перезапуском. Поэтому здесь
 * нет ни реактивности, ни подписки: таблица ставится один раз до первой
 * отрисовки (`startLanguage`), и `t()` — простая функция.
 *
 * Модуль чистый — без обращений к ядру: тест ставит таблицу сам.
 */

/** Формы числа по правилам Unicode — те же имена, что у `Intl.PluralRules`. */
export type PluralForm = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** Строка или формы числа: «1 слово», «2 слова», «5 слов». */
export type Message = string | Partial<Record<PluralForm, string>>;

export type Table = Readonly<Record<string, Message>>;

/** Подстановки `{имя}` в строку. Числа — как есть: разряды — `formatNumber`. */
export type Params = Readonly<Record<string, string | number>>;

interface Current {
  code: string;
  table: Table;
  plural: Intl.PluralRules;
  number: Intl.NumberFormat;
}

let current: Current | null = null;

/** Поставить язык и его таблицу. Зовётся один раз — при старте окна. */
export function useLanguage(code: string, table: Table): void {
  current = {
    code,
    table,
    plural: new Intl.PluralRules(code),
    number: new Intl.NumberFormat(code),
  };
}

/** Код языка окна: `ru`, `en`. До старта — русский, язык по умолчанию. */
export function language(): string {
  return current?.code ?? 'ru';
}

/**
 * Строка по ключу, с подстановками.
 *
 * Ключа нет — возвращается сам ключ: видно сразу и называет, чего
 * не хватает. Этого не бывает — таблицы сверяет тест, — но экран
 * с ключом лучше пустого места.
 */
export function t(key: string, params?: Params): string {
  const message = lookup(key);
  if (typeof message !== 'string') return key;
  return fill(message, params);
}

/**
 * Строка с числом — в той форме, которой число требует язык.
 *
 * `{count}` подставляется само, с разрядами: «1 234 слова». Остальные
 * подстановки — как у `t()`.
 */
export function tn(key: string, count: number, params?: Params): string {
  const message = lookup(key);
  if (message === undefined) return key;
  const forms = typeof message === 'string' ? { other: message } : message;
  const form = current?.plural.select(count) ?? 'other';
  // Нужной формы нет — «other», потом «many»: у русского дробные числа
  // идут в «other», а у целых его нет, и таблица его не обязана держать.
  const text = forms[form] ?? forms.other ?? forms.many ?? Object.values(forms)[0] ?? key;
  return fill(text, { count: formatNumber(count), ...params });
}

/** Число с разрядами и дробной частью по правилам языка: `12 345`, `1,4`. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  if (!current) return String(value);
  return options ? new Intl.NumberFormat(current.code, options).format(value) : current.number.format(value);
}

let warned = false;

function lookup(key: string): Message | undefined {
  if (!current) {
    // Строку попросили до того, как язык поставлен: значит, её собирают
    // при загрузке модуля, а не при показе, — и она навсегда останется
    // ключом. Громко, но один раз.
    if (!warned) {
      warned = true;
      console.error(`l10n: «${key}» запрошен до выбора языка — строку собирают при загрузке модуля`);
    }
    return undefined;
  }
  return current.table[key];
}

/**
 * Подстановка `{имя}`. Имя, которого нет среди подстановок, остаётся как
 * написано: `{{date}}` в тексте о шаблонах — это текст, а не подстановка.
 */
function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}
