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
  /** Таблицы по старшинству: свой перевод, встроенная того же кода, английская. */
  tables: readonly Table[];
  plural: Intl.PluralRules;
  number: Intl.NumberFormat;
}

let current: Current | null = null;

/**
 * Поставить язык и его таблицы. Зовётся один раз — при старте окна.
 *
 * Таблиц бывает несколько (задача 153): свой перевод из папки данных может
 * быть неполным, и чего в нём нет, берётся у следующей — у встроенной
 * таблицы того же языка, потом у английской.
 */
export function useLanguage(code: string, tables: Table | readonly Table[]): void {
  current = {
    code,
    tables: isTableList(tables) ? tables : [tables],
    plural: pluralRules(code),
    number: numberFormat(code),
  };
}

function isTableList(tables: Table | readonly Table[]): tables is readonly Table[] {
  return Array.isArray(tables);
}

/**
 * Правила `Intl` для кода своего перевода. Код проверен ядром по виду,
 * но `Intl` может его не принять — тогда правила английские, а не отказ
 * всего окна.
 */
function pluralRules(code: string): Intl.PluralRules {
  try {
    return new Intl.PluralRules(code);
  } catch {
    return new Intl.PluralRules('en');
  }
}

function numberFormat(code: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(code);
  } catch {
    return new Intl.NumberFormat('en');
  }
}

/**
 * Имя языка на нём самом, с заглавной: «Русский», «English», «Deutsch».
 * Так человек находит свой язык в списке, не читая текущий. Незнакомый
 * `Intl` код остаётся кодом.
 */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
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

/** Кусок строки: текст или место вставки `{имя}`. */
export type Part = { text: string } | { slot: string };

/**
 * Разобрать строку на текст и места вставок — для строк, внутри которых
 * окно рисует своё: `<code>`, ссылку, значок. Разметку в строку перевода
 * не кладут: свой перевод — чужой файл, и выводить его как HTML значило бы
 * пустить в окно чужой код (задача 153). Место вставки окно заполняет само.
 *
 * Строка приходит из `t()` без подстановок — так ключ остаётся буквальным
 * и сверяется тестом: `slots(t('callouts.intro'))`.
 */
export function slots(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ slot: match[1]! });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Число с разрядами и дробной частью по правилам языка: `12 345`, `1,4`. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  if (!current) return String(value);
  if (!options) return current.number.format(value);
  try {
    return new Intl.NumberFormat(current.code, options).format(value);
  } catch {
    return new Intl.NumberFormat('en', options).format(value);
  }
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
  for (const table of current.tables) {
    const message = table[key];
    if (message !== undefined) return message;
  }
  return undefined;
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
