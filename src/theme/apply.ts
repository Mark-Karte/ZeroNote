import type { AppearanceState } from '../ipc/appearance';

/**
 * Применение набора токенов к документу.
 *
 * Это единственное место во фронтенде, которое трогает значения токенов.
 * Никакой логики выбора цвета здесь нет и быть не должно: что именно
 * применять, решает Rust, здесь только выставляются свойства.
 */
export function applyAppearance(state: AppearanceState): void {
  const root = document.documentElement;

  for (const [name, value] of Object.entries(state.tokens)) {
    root.style.setProperty(`--zn-${name}`, value);
  }

  // Нужен CSS: по нему выставляется color-scheme, от которого зависит вид
  // системных полос прокрутки и полей ввода.
  root.dataset['appearance'] = state.appearance;
}
