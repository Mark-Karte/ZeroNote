import type { Finding } from '../ipc/appearance';
import { formatNumber, t } from '../l10n';

/**
 * Слова и виды значений редактора тем (задача 105).
 *
 * Состав палитры и токенов приходит из ядра — здесь только то, как их
 * назвать человеку и каким полем править. Подписи палитры сверяются
 * тестом с файлами встроенных тем: новый ключ без подписи остался бы
 * в окне голым именем.
 *
 * Подписи — выбором, а не таблицей модуля (задача 153): строка берётся
 * на языке окна при показе, а ключ пишется буквально — иначе тест
 * не сверит его с таблицей строк (Р-314).
 */

/** Подпись ключа палитры; незнакомый ключ — `null`. */
export function paletteLabel(key: string): string | null {
  switch (key) {
    case 'bg-0':
      return t('theme.palette.bg-0');
    case 'bg-1':
      return t('theme.palette.bg-1');
    case 'bg-2':
      return t('theme.palette.bg-2');
    case 'bg-3':
      return t('theme.palette.bg-3');
    case 'bg-4':
      return t('theme.palette.bg-4');
    case 'fg-0':
      return t('theme.palette.fg-0');
    case 'fg-1':
      return t('theme.palette.fg-1');
    case 'fg-2':
      return t('theme.palette.fg-2');
    case 'fg-on-accent':
      return t('theme.palette.fg-on-accent');
    case 'accent':
      return t('theme.palette.accent');
    case 'accent-hover':
      return t('theme.palette.accent-hover');
    case 'accent-soft':
      return t('theme.palette.accent-soft');
    case 'accent-selection':
      return t('theme.palette.accent-selection');
    case 'border':
      return t('theme.palette.border');
    case 'border-subtle':
      return t('theme.palette.border-subtle');
    case 'danger':
      return t('theme.palette.danger');
    case 'warning':
      return t('theme.palette.warning');
    case 'success':
      return t('theme.palette.success');
    case 'syn-keyword':
      return t('theme.palette.syn-keyword');
    case 'syn-string':
      return t('theme.palette.syn-string');
    case 'syn-comment':
      return t('theme.palette.syn-comment');
    case 'syn-number':
      return t('theme.palette.syn-number');
    case 'syn-type':
      return t('theme.palette.syn-type');
    case 'syn-function':
      return t('theme.palette.syn-function');
    case 'shadow-weak':
      return t('theme.palette.shadow-weak');
    case 'shadow-strong':
      return t('theme.palette.shadow-strong');
    case 'overlay':
      return t('theme.palette.overlay');
    case 'bg-block':
      return t('theme.palette.bg-block');
    default:
      return null;
  }
}

/** Разделы токенов в порядке файла темы. */
export const SECTION_IDS = ['color', 'font', 'space', 'radius', 'border', 'shadow', 'motion', 'z', 'control'] as const;

/** Подпись раздела токенов. */
export function sectionTitle(id: string): string {
  switch (id) {
    case 'color':
      return t('theme.section.color');
    case 'font':
      return t('theme.section.font');
    case 'space':
      return t('theme.section.space');
    case 'radius':
      return t('theme.section.radius');
    case 'border':
      return t('theme.section.border');
    case 'shadow':
      return t('theme.section.shadow');
    case 'motion':
      return t('theme.section.motion');
    case 'z':
      return t('theme.section.z');
    case 'control':
      return t('theme.section.control');
    default:
      return id;
  }
}

/** Роль, которую называет проверка читаемости. */
function label(token: string): string {
  switch (token) {
    case 'color-fg-default':
      return t('theme.palette.fg-0');
    case 'color-fg-muted':
      return t('theme.palette.fg-1');
    case 'color-fg-subtle':
      return t('theme.palette.fg-2');
    case 'color-fg-on-accent':
      return t('theme.palette.fg-on-accent');
    case 'color-accent':
      return t('theme.palette.accent');
    case 'color-danger':
      return t('theme.palette.danger');
    case 'color-warning':
      return t('theme.palette.warning');
    case 'color-success':
      return t('theme.palette.success');
    case 'color-syntax-keyword':
      return t('theme.palette.syn-keyword');
    case 'color-syntax-string':
      return t('theme.palette.syn-string');
    case 'color-syntax-comment':
      return t('theme.palette.syn-comment');
    case 'color-syntax-number':
      return t('theme.palette.syn-number');
    case 'color-syntax-type':
      return t('theme.palette.syn-type');
    case 'color-syntax-function':
      return t('theme.palette.syn-function');
    default:
      return token;
  }
}

/**
 * Фон, на котором проверяли контраст, — в той форме, в какой он стоит
 * после «на»: «на панели», «на подложке». Своей формой, а не подписью
 * палитры: по-русски у фона другой падеж.
 */
function ground(token: string): string {
  switch (token) {
    case 'color-bg-surface':
      return t('theme.ground.surface');
    case 'color-bg-raised':
      return t('theme.ground.raised');
    case 'color-bg-canvas':
      return t('theme.ground.canvas');
    default:
      return label(token);
  }
}

/** Число с одним знаком после запятой — запятая или точка по языку окна. */
function decimal(value: number): string {
  return formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Находка проверки читаемости словами. */
export function findingText(finding: Finding): string {
  switch (finding.kind) {
    case 'contrast':
      return finding.token === 'color-fg-on-accent'
        ? t('theme.finding.on-accent', { value: decimal(finding.value), need: decimal(finding.need) })
        : t('theme.finding.contrast', {
            what: label(finding.token),
            ground: ground(finding.against),
            value: decimal(finding.value),
            need: decimal(finding.need),
          });
    case 'distance':
      return t('theme.finding.distance', {
        what: label(finding.token),
        other: label(finding.against).toLowerCase(),
        value: Math.round(finding.value),
        need: Math.round(finding.need),
      });
    case 'unchecked':
      return t('theme.finding.unchecked', { what: label(finding.token) });
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
    return t('theme.note.toolbar-size');
  }
  if (['font-family-ui', 'font-size-ui', 'font-family-editor', 'font-size-editor'].includes(name)) {
    return t('theme.note.fonts');
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
