import { listen } from '@tauri-apps/api/event';
import { fetchAppearance, type AppearanceState } from '../ipc/appearance';
import { applyAppearance } from './apply';

/**
 * Текущее оформление. Компоненты читают отсюда, но не меняют: смена темы —
 * это правка settings.toml, а не изменение состояния в интерфейсе.
 */
export const appearance = $state<{ current: AppearanceState | null }>({
  current: null,
});

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/** Перечитать оформление и применить его. */
export async function refresh(): Promise<void> {
  const next = await fetchAppearance(darkQuery.matches);
  applyAppearance(next);
  appearance.current = next;
}

/**
 * Первое применение плюс подписки.
 *
 * Два источника изменений:
 * 1. Пользователь сменил тему Windows — ловим медиазапросом прямо в вебвью.
 * 2. Пользователь поправил settings.toml или файл темы — ядро следит за
 *    файлами и присылает событие. Событие пустое: в ответ мы запрашиваем
 *    состояние целиком, чтобы не разъехаться с тем, что лежит на диске.
 */
export async function startAppearance(): Promise<void> {
  await refresh();

  darkQuery.addEventListener('change', () => {
    void refresh();
  });

  await listen('appearance-changed', () => {
    void refresh();
  });
}
