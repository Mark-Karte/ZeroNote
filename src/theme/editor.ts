import type { Finding } from '../ipc/appearance';

/**
 * Слова и виды значений редактора тем (задача 105).
 *
 * Состав палитры и токенов приходит из ядра — здесь только то, как их
 * назвать человеку и каким полем править. Список подписей палитры
 * сверяется тестом с файлами встроенных тем: новый ключ без подписи
 * остался бы в окне голым именем.
 */

/** Подписи ключей палитры — в порядке, в каком они стоят во встроенных темах. */
export const PALETTE_LABELS: Record<string, string> = {
  'bg-0': 'Подложка окна',
  'bg-1': 'Панели',
  'bg-2': 'Рабочая область',
  'bg-3': 'Наведение',
  'bg-4': 'Нажатие',
  'fg-0': 'Основной текст',
  'fg-1': 'Приглушённый текст',
  'fg-2': 'Тихий текст',
  'fg-on-accent': 'Текст на акценте',
  accent: 'Акцент',
  'accent-hover': 'Акцент под указателем',
  'accent-soft': 'Подсветка строки',
  'accent-selection': 'Выделение текста',
  border: 'Граница',
  'border-subtle': 'Тихая граница',
  danger: 'Опасность',
  warning: 'Внимание',
  success: 'Успех',
  'syn-keyword': 'Ключевые слова',
  'syn-string': 'Строки',
  'syn-comment': 'Комментарии',
  'syn-number': 'Числа',
  'syn-type': 'Типы',
  'syn-function': 'Функции',
  'shadow-weak': 'Тень слабая',
  'shadow-strong': 'Тень плотная',
  overlay: 'Затемнение под диалогом',
  'bg-block': 'Подложка блока кода',
};

/** Разделы токенов в порядке файла темы, с подписями. */
export const SECTIONS: { id: string; title: string }[] = [
  { id: 'color', title: 'Цвета ролей' },
  { id: 'font', title: 'Шрифты и кегли' },
  { id: 'space', title: 'Отступы' },
  { id: 'radius', title: 'Скругления' },
  { id: 'border', title: 'Границы' },
  { id: 'shadow', title: 'Тени' },
  { id: 'motion', title: 'Движение' },
  { id: 'z', title: 'Слои' },
  { id: 'control', title: 'Размеры элементов' },
];

/** Роли, которые называет проверка читаемости. */
const ROLE_LABELS: Record<string, string> = {
  'color-fg-default': 'Основной текст',
  'color-fg-muted': 'Приглушённый текст',
  'color-fg-subtle': 'Тихий текст',
  'color-fg-on-accent': 'Текст на акценте',
  'color-accent': 'Акцент',
  'color-danger': 'Опасность',
  'color-warning': 'Внимание',
  'color-success': 'Успех',
  'color-syntax-keyword': 'Ключевые слова',
  'color-syntax-string': 'Строки',
  'color-syntax-comment': 'Комментарии',
  'color-syntax-number': 'Числа',
  'color-syntax-type': 'Типы',
  'color-syntax-function': 'Функции',
  'color-bg-surface': 'панели',
  'color-bg-raised': 'рабочей области',
  'color-bg-canvas': 'подложке',
};

const label = (token: string): string => ROLE_LABELS[token] ?? token;

/** Число по-русски: запятая, один знак после неё. */
function decimal(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/** Находка проверки читаемости словами. */
export function findingText(finding: Finding): string {
  switch (finding.kind) {
    case 'contrast': {
      const where =
        finding.token === 'color-fg-on-accent' ? 'Текст на акценте' : `${label(finding.token)} на ${label(finding.against)}`;
      return `${where}: ${decimal(finding.value)} : 1, нужно ${decimal(finding.need)}`;
    }
    case 'distance':
      return (
        `${label(finding.token)} и ${label(finding.against).toLowerCase()} почти одного цвета: ` +
        `различие ${Math.round(finding.value)}, нужно ${Math.round(finding.need)}`
      );
    case 'unchecked':
      return `${label(finding.token)}: цвет задан не как #rrggbb — читаемость не посчитать`;
  }
}

/**
 * Пояснение к токену, который выбирают не здесь.
 *
 * Размер кнопок панели: тема задаёт три ступени, а какая из них на экране —
 * решает вкладка «Панель инструментов» (Р-249). Шрифты: тема задаёт
 * умолчание, выбор в «Шрифтах» выше сильнее темы (задача 105). Без
 * пояснения правка такого токена выглядела бы как «не работает».
 */
export function tokenNote(name: string): string | null {
  if (name.startsWith('control-toolbar-button-size')) {
    return 'ступень выбирается во вкладке «Панель инструментов»';
  }
  if (['font-family-ui', 'font-size-ui', 'font-family-editor', 'font-size-editor'].includes(name)) {
    return 'выбор в «Шрифтах» выше сильнее темы';
  }
  return null;
}

/** Каким полем править значение. */
export type ValueKind = 'color' | 'length' | 'number' | 'text';

const LENGTH = /^(-?\d*\.?\d+)(px|em|rem|ch|ms|s|%)$/;
const NUMBER = /^-?\d*\.?\d+$/;

/**
 * Вид значения — по разделу и по умолчанию токена. Цвета — в палитре
 * и в разделе `color`; длина — число с единицей; число — без единицы
 * (слои, начертания, межстрочный интервал); остальное — текст (тени,
 * кривые движения, списки шрифтов).
 */
export function kindOf(section: string, defaultValue: string): ValueKind {
  if (section === 'palette' || section === 'color') return 'color';
  const value = defaultValue.trim();
  if (LENGTH.test(value)) return 'length';
  if (NUMBER.test(value)) return 'number';
  return 'text';
}

/**
 * Свойство CSS, которым проверить значение токена: `CSS.supports(свойство,
 * значение)` — судья, который точно знает, что браузер поймёт.
 *
 * Найдено на живом окне: `#6094ff#ff7a45` — две записи цвета, склеенные
 * промахом мимо «выделить всё», — записалось в тему, и акцент пропал
 * со всего окна. Ядро цвета не проверяет и не должно: что понимает CSS,
 * знает браузер.
 */
export function cssPropertyOf(section: string, key: string): string {
  switch (section) {
    case 'palette':
    case 'color':
      return 'color';
    case 'shadow':
      return 'box-shadow';
    case 'z':
      return 'z-index';
    case 'radius':
      return 'border-radius';
    case 'border':
      return 'border-top-width';
    case 'space':
      return 'padding-top';
    case 'motion':
      return key === 'easing' ? 'transition-timing-function' : 'transition-duration';
    case 'font':
      if (key.startsWith('family')) return 'font-family';
      if (key.startsWith('weight')) return 'font-weight';
      if (key.startsWith('line-height')) return 'line-height';
      if (key.startsWith('letter-spacing')) return 'letter-spacing';
      return 'font-size';
    default:
      return 'width';
  }
}

/** Подставить цвета палитры вместо ссылок `{palette.ключ}`. Нет ключа — `null`. */
export function expandPalette(value: string, palette: Record<string, string>): string | null {
  let missing = false;
  const expanded = value.replace(/\{palette\.([a-z0-9-]+)\}/g, (_, key: string) => {
    const found = palette[key];
    if (found === undefined) missing = true;
    return found ?? '';
  });
  return missing ? null : expanded;
}

/** `13px` → 13 и `px`. Не длина — `null`. */
export function splitLength(value: string): { amount: number; unit: string } | null {
  const match = LENGTH.exec(value.trim());
  if (!match) return null;
  return { amount: Number(match[1]), unit: match[2] as string };
}
