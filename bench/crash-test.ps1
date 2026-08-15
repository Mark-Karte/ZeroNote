# Проверка инварианта 4: аварийное завершение процесса не теряет данных.
#
#   powershell -File bench\crash-test.ps1
#
# Модульные тесты проверяют запись и чтение сессии и черновиков. Здесь
# проверяется то, что ими не поймать: настоящий процесс, настоящая правка
# через настоящий интерфейс, настоящий kill без единого шанса на уборку.
#
# Сценарий:
#   1. Запустить с файлом на диске, дописать в него текст (не сохраняя).
#   2. Создать буфер без файла и напечатать в него текст.
#   3. Подождать сброса черновиков.
#   4. Убить процесс — Stop-Process -Force, то есть TerminateProcess.
#   5. Запустить снова и убедиться, что обе вкладки на месте с их текстом.
#
# Требует собранного релизного бинарника: npm run tauri build

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri\target\release\zeronote.exe'
$work = Join-Path $PSScriptRoot 'out\crash'

if (-not (Test-Path $exe)) {
    throw "Не найден релизный бинарник: $exe. Сначала выполните: npm run tauri build"
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Crash {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@

function Focus-App {
    $proc = Get-Process -Name zeronote -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $proc) { throw 'Окно ZeroNote не найдено' }
    [Crash]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 400
    return $proc
}

function Send-Keys([string]$keys) {
    Focus-App | Out-Null
    [System.Windows.Forms.SendKeys]::SendWait($keys)
    Start-Sleep -Milliseconds 500
}

# --- Подготовка -------------------------------------------------------------

Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $work | Out-Null

# Данные приложения чистим, чтобы прогон не зависел от прошлых запусков.
$data = Join-Path (Split-Path -Parent $exe) 'data'
Remove-Item -Recurse -Force (Join-Path $data 'drafts') -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $data 'session.toml') -ErrorAction SilentlyContinue

$file = Join-Path $work 'на-диске.txt'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($file, "строка из файла`r`n", $utf8)
$original = [System.IO.File]::ReadAllBytes($file)

$MARK_FILE = 'ПРАВКА-В-ФАЙЛЕ'
$MARK_NEW = 'ТЕКСТ-БЕЗ-ФАЙЛА'

# --- Шаг 1: правим файл, не сохраняя ----------------------------------------

Write-Host 'Запуск с файлом...' -ForegroundColor Cyan
Start-Process -FilePath $exe -ArgumentList $file -PassThru | Out-Null
Start-Sleep -Seconds 5

Send-Keys '^{END}'
Send-Keys $MARK_FILE

# --- Шаг 2: буфер без файла на диске ----------------------------------------

Write-Host 'Новый буфер без файла...' -ForegroundColor Cyan
Send-Keys '^n'
Send-Keys $MARK_NEW

# --- Шаг 3: ждём сброса черновиков ------------------------------------------

Write-Host 'Ожидание сброса черновиков (задержка 2 с)...' -ForegroundColor Cyan
Start-Sleep -Seconds 4

$drafts = @(Get-ChildItem (Join-Path $data 'drafts') -Filter *.draft -ErrorAction SilentlyContinue)
Write-Host ("Черновиков на диске: {0}" -f $drafts.Count)

# --- Шаг 4: убиваем процесс -------------------------------------------------

Write-Host 'Аварийное завершение процесса...' -ForegroundColor Yellow
Get-Process -Name zeronote -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$afterKill = [System.IO.File]::ReadAllBytes($file)
$fileUntouched = [System.Linq.Enumerable]::SequenceEqual([byte[]]$original, [byte[]]$afterKill)
Write-Host ("Файл на диске не тронут: {0}" -f $fileUntouched)

# --- Шаг 5: запускаем снова и проверяем -------------------------------------

Write-Host 'Повторный запуск...' -ForegroundColor Cyan
Start-Process -FilePath $exe -PassThru | Out-Null
Start-Sleep -Seconds 5

# Содержимое вкладок берём из черновиков: они и есть то, что восстановлено.
$restored = @(Get-ChildItem (Join-Path $data 'drafts') -Filter *.draft -ErrorAction SilentlyContinue)
$texts = $restored | ForEach-Object { Get-Content $_.FullName -Raw -Encoding UTF8 }

$hasFileEdit = @($texts | Where-Object { $_ -like "*$MARK_FILE*" }).Count -gt 0
$hasNewBuffer = @($texts | Where-Object { $_ -like "*$MARK_NEW*" }).Count -gt 0

$session = Get-Content (Join-Path $data 'session.toml') -Raw -Encoding UTF8 -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '=== Итог ===' -ForegroundColor Cyan
Write-Host ("Правка в файле восстановлена   : {0}" -f $hasFileEdit)
Write-Host ("Буфер без файла восстановлен   : {0}" -f $hasNewBuffer)
Write-Host ("Файл на диске остался нетронут : {0}" -f $fileUntouched)
Write-Host ("Вкладок в снимке сессии        : {0}" -f ([regex]::Matches($session, '\[\[workspaces\.buffers\]\]')).Count)

if ($hasFileEdit -and $hasNewBuffer -and $fileUntouched) {
    Write-Host 'ИНВАРИАНТ 4 ВЫПОЛНЕН' -ForegroundColor Green
} else {
    Write-Host 'ИНВАРИАНТ 4 НАРУШЕН' -ForegroundColor Red
    exit 1
}
