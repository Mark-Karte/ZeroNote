// `vitest/config` — это `vite/config` плюс типы для секции `test`.
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],

  // Vite не должен затирать вывод cargo — иначе ошибки сборки Rust не видно.
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    // Пересборка фронтенда не должна запускаться от изменений в Rust-части.
    watch: { ignored: ['**/src-tauri/**'] },
  },

  build: {
    // WebView2 на Windows 10/11 — современный Chromium; понижать цель незачем.
    target: 'chrome110',
    sourcemap: false,
  },

  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // Стиль документа приезжает в печать строкой (`?inline`), и тест
    // печати проверяет, что он там есть. Без этого vitest отдаёт вместо
    // любого CSS пустую строку. Таблица Temml — туда же: экспорт в HTML
    // кладёт её в файл строкой (задача 116), и тест это проверяет.
    css: { include: [/src[\\/](html|print)[\\/].*\.css/, /temml[\\/]dist[\\/]Temml-Local\.css/] },
  },
});
