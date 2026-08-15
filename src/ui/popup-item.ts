/** Пункт всплывающего меню. Отдельным файлом: типы из компонентов не импортируются. */
export interface PopupItem {
  id: string;
  label: string;
  /** Заголовок раздела, показываемый над этим пунктом. */
  section?: string | undefined;
  checked?: boolean | undefined;
  disabled?: boolean | undefined;
  hint?: string | undefined;
}
