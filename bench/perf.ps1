# Измерительный стенд ZeroNote.
#
#   powershell -File bench\perf.ps1                 # все замеры
#   powershell -File bench\perf.ps1 -Only startup   # только старт
#   powershell -File bench\perf.ps1 -Only ipc       # только граница IPC
#
# Требует собранного релизного бинарника:
#   npm run tauri build
#
# Числа из вывода переносятся в DESIGN.md, раздел «Измерения».
# Замеры на отладочной сборке бессмысленны и скриптом не поддерживаются.

param(
    [ValidateSet('all', 'startup', 'ipc', 'open', 'tree', 'index', 'highlight', 'live', 'media')]
    [string]$Only = 'all',

    [int]$Runs = 9
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri\target\release\zeronote.exe'
$outDir = Join-Path $PSScriptRoot 'out'

if (-not (Test-Path $exe)) {
    throw "Не найден релизный бинарник: $exe. Сначала выполните: npm run tauri build"
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Папка данных выпускной сборки: она рядом с исполняемым файлом (Р-008).
$dataDir = Join-Path (Split-Path -Parent $exe) 'data'

# --- Условия замера. Оба — из приёмки этапа 9, оба стоили ложных чисел. ---

# Первое: живой сосед. Он держит среду WebView2 тёплой и занижает тёплый старт
# на четверть — та же сборка дала 422 мс без соседа и 292 мс с ним. С задачи 69
# сосед с той же папкой данных замер уже не искажает, а срывает: второй
# экземпляр отдаёт аргументы первому и выходит, отчёта не будет вовсе (Р-191).
# Поэтому проверяем и говорим прямо, а не оставляем гадать над пустым отчётом.
$alive = @(Get-Process -Name zeronote -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $exe })
if ($alive.Count -gt 0) {
    throw ("Уже запущен ZeroNote из той же сборки (PID $($alive[0].Id)). " +
        'Замер при живом соседе недостоверен: он держит среду WebView2 тёплой. ' +
        'Закройте окно и повторите.')
}

function Get-Median([double[]]$values) {
    $sorted = $values | Sort-Object
    $n = $sorted.Count
    if ($n -eq 0) { return [double]::NaN }
    if ($n % 2 -eq 1) { return $sorted[[int](($n - 1) / 2)] }
    return ($sorted[$n / 2 - 1] + $sorted[$n / 2]) / 2
}

function Invoke-StartupRun {
    param([string]$ReportPath)

    if (Test-Path $ReportPath) { Remove-Item $ReportPath -Force }

    # Замеряем полное время жизни процесса: от запроса на запуск до выхода.
    # Приложение выходит само, как только интерфейс отрисован и окно показано,
    # поэтому это и есть «время до готовности к вводу» — включая загрузку
    # образа, инициализацию WebView2 и первый кадр.
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $exe `
        -ArgumentList @('--bench', 'startup', '--bench-out', $ReportPath) `
        -PassThru -WindowStyle Normal
    $proc.WaitForExit()
    $sw.Stop()

    if (-not (Test-Path $ReportPath)) {
        throw 'Приложение завершилось, не записав отчёт. Замер недостоверен.'
    }

    [pscustomobject]@{
        WallMs = $sw.Elapsed.TotalMilliseconds
        # Число изнутри процесса: от входа в main() до готовности интерфейса.
        # Разница с WallMs — это загрузчик Windows и создание процесса.
        InnerMs = [double](Get-Content $ReportPath -Raw -Encoding UTF8).Trim()
    }
}

function Measure-Startup {
    $reportPath = Join-Path $outDir 'startup.txt'

    Write-Host ''
    Write-Host '=== Старт до готовности к вводу ===' -ForegroundColor Cyan
    Write-Host ''
    Write-Host 'Холодный старт: рабочий набор процесса и кэш файловой системы' -ForegroundColor DarkGray
    Write-Host 'не сбрасываются программно — это потребовало бы прав администратора' -ForegroundColor DarkGray
    Write-Host 'и всё равно не воспроизводило бы состояние после перезагрузки.' -ForegroundColor DarkGray
    Write-Host 'За холодный принимается ПЕРВЫЙ запуск после загрузки системы:' -ForegroundColor DarkGray
    Write-Host 'запускайте скрипт сразу после перезагрузки и берите строку "первый запуск".' -ForegroundColor DarkGray
    Write-Host ''

    # Второе условие: сессия. Замер восстанавливает её из папки данных, и её
    # содержимое на число влияет — десяток вкладок с файлами это чтение
    # десятка файлов до первого кадра. Чтобы числа разных версий сравнивались,
    # старт меряется с ПУСТОЙ сессией, а настоящая на это время отходит в бок.
    $session = Join-Path $dataDir 'session.toml'
    $stashed = "$session.bench"
    $hadSession = Test-Path $session
    if ($hadSession) { Move-Item $session $stashed -Force }

    Write-Host 'Сессия на время замера пуста: её содержимое влияет на число.' -ForegroundColor DarkGray
    Write-Host ''

    try {
        $first = Invoke-StartupRun -ReportPath $reportPath

        $warmWall = @()
        $warmInner = @()
        for ($i = 1; $i -lt $Runs; $i++) {
            $r = Invoke-StartupRun -ReportPath $reportPath
            $warmWall += $r.WallMs
            $warmInner += $r.InnerMs
        }
    }
    finally {
        # Возвращаем сессию в любом случае: прерванный замер не должен
        # оставлять человека без открытых вкладок.
        if ($hadSession) { Move-Item $stashed $session -Force }
    }

    Write-Host ('первый запуск   : {0,7:N0} мс полное, {1,7:N0} мс от main()' -f $first.WallMs, $first.InnerMs)
    Write-Host ('тёплый (медиана): {0,7:N0} мс полное, {1,7:N0} мс от main()' -f (Get-Median $warmWall), (Get-Median $warmInner))
    Write-Host ('тёплый (мин)    : {0,7:N0} мс полное, {1,7:N0} мс от main()' -f ($warmWall | Measure-Object -Minimum).Minimum, ($warmInner | Measure-Object -Minimum).Minimum)
    Write-Host ''
    Write-Host ('Цели: холодный <= 2000 мс, тёплый <= 800 мс' ) -ForegroundColor DarkGray

    $warmMedian = Get-Median $warmWall
    if ($first.WallMs -gt 2000) { Write-Host 'ПРЕВЫШЕНА цель холодного старта' -ForegroundColor Red }
    if ($warmMedian -gt 800) { Write-Host 'ПРЕВЫШЕНА цель тёплого старта' -ForegroundColor Red }
}

function Measure-InApp {
    param([string]$Mode, [string]$Title, [string]$FileName)

    $reportPath = Join-Path $outDir $FileName
    if (Test-Path $reportPath) { Remove-Item $reportPath -Force }

    Write-Host ''
    Write-Host "=== $Title ===" -ForegroundColor Cyan

    $proc = Start-Process -FilePath $exe `
        -ArgumentList @('--bench', $Mode, '--bench-out', $reportPath) `
        -PassThru -WindowStyle Normal
    $proc.WaitForExit()

    if (-not (Test-Path $reportPath)) {
        throw 'Приложение завершилось, не записав отчёт. Замер недостоверен.'
    }

    Write-Host ''
    # Отчёт пишет Rust, то есть UTF-8 без BOM. Без явного -Encoding
    # Windows PowerShell 5.1 прочитает его как ANSI и выдаст мусор.
    Get-Content $reportPath -Raw -Encoding UTF8 | Write-Host
}

if ($Only -eq 'all' -or $Only -eq 'startup') { Measure-Startup }
if ($Only -eq 'all' -or $Only -eq 'open') {
    Measure-InApp -Mode 'open' -Title 'Открытие файла: диск, кодировка, раскодирование' -FileName 'open.md'
    Write-Host 'Цель: файл 5 МБ <= 500 мс' -ForegroundColor DarkGray
}
if ($Only -eq 'all' -or $Only -eq 'tree') {
    Measure-InApp -Mode 'tree' -Title 'Дерево файлов: чтение папки и полный обход' -FileName 'tree.md'
    Write-Host 'Цели: папка на 10 000 записей <= 300 мс, полный обход <= 3 с' -ForegroundColor DarkGray
}
if ($Only -eq 'all' -or $Only -eq 'index') {
    Measure-InApp -Mode 'index' -Title 'Индексация 10 000 файлов' -FileName 'index.md'
    Write-Host 'Цель: полная индексация <= 30 с, интерфейс отзывчив' -ForegroundColor DarkGray
}
if ($Only -eq 'all' -or $Only -eq 'highlight') {
    Measure-InApp -Mode 'highlight' -Title 'Подсветка синтаксиса: открытие и ввод' -FileName 'highlight.md'
    Write-Host 'Цель: ввод символа при открытом файле 10 МБ без заметной задержки' -ForegroundColor DarkGray
}
if ($Only -eq 'all' -or $Only -eq 'live') {
    Measure-InApp -Mode 'live' -Title 'Инвариант 6: ввод во время индексации' -FileName 'live.md'
    Write-Host 'Цель: задержка ввода под нагрузкой не отличается от задержки в покое' -ForegroundColor DarkGray
}
if ($Only -eq 'all' -or $Only -eq 'media') {
    Measure-InApp -Mode 'media' -Title 'Показ картинки и PDF' -FileName 'media.md'
    Write-Host 'Цели нет: показ файла — разовое действие, а не путь ввода.' -ForegroundColor DarkGray
}
if ($Only -eq 'all' -or $Only -eq 'ipc') {
    Measure-InApp -Mode 'ipc' -Title 'Граница Rust <-> фронтенд' -FileName 'ipc.md'
}

Write-Host ''
Write-Host "Отчёты: $outDir" -ForegroundColor DarkGray
