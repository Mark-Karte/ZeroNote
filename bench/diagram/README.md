# Замер схем mermaid

Сколько окно не отвечает, пока рисуется схема (задача 117). Меряется наш
же путь — `renderDiagram` из `src/editor/diagram-render.ts`, — в том же
движке Chromium, что у WebView2.

```powershell
node node_modules\vite\bin\vite.js build bench\diagram --outDir ..\out\diagram --emptyOutDir --base ./
cd bench\out\diagram
node ..\..\..\node_modules\vite\bin\vite.js preview --outDir . --port 4174
```

Открыть `http://localhost:4174` в Edge и подождать строку «ГОТОВО».

**Страницу надо отдавать сервером.** С `file://` модульные скрипты
не грузятся, а безголовый Edge с `--dump-dom` снимает страницу раньше,
чем замер кончится: отрисовка асинхронная.

Числа задачи 117 (2026-09-26): блок-схема в 5 узлов — 26 мс, в 30 — 107,
в 150 (6,4 тысячи знаков) — 545; последовательность в 200 сообщений —
100 мс. Первая отрисовка вида схемы дороже: грузится его кусок.
