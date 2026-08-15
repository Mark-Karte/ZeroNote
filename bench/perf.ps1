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
    [ValidateSet('all', 'startup', 'ipc', 'open')]
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

    $first = Invoke-StartupRun -ReportPath $reportPath

    $warmWall = @()
    $warmInner = @()
    for ($i = 1; $i -lt $Runs; $i++) {
        $r = Invoke-StartupRun -ReportPath $reportPath
        $warmWall += $r.WallMs
        $warmInner += $r.InnerMs
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
if ($Only -eq 'all' -or $Only -eq 'ipc') {
    Measure-InApp -Mode 'ipc' -Title 'Граница Rust <-> фронтенд' -FileName 'ipc.md'
}

Write-Host ''
Write-Host "Отчёты: $outDir" -ForegroundColor DarkGray
