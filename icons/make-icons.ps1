# Собирает набор значков для сборки: из icons/ в src-tauri/icons/.
#
# Здесь лежат исходники знака (см. README.md), а Tauri читает src-tauri/icons/.
# Скрипт — мост между ними, и запускать его нужно только когда исходники
# изменились: результат лежит в репозитории, сборка его не вызывает.
#
#   powershell -File icons\make-icons.ps1
#
# PNG просто копируются: у Tauri для них свои имена и размеры. Собирать
# приходится только .ico — многоразмерного файла в наборе нет, а Windows
# берёт значок именно из него: на ярлык, в панель задач, в Alt+Tab.

#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$source = $PSScriptRoot
$target = Join-Path (Split-Path -Parent $PSScriptRoot) 'src-tauri\icons'

# Размеры, которые Windows спрашивает у .ico. Меньше 16 не бывает, больше 256
# формат не хранит; между ними система берёт ближайший больший и уменьшает.
$icoSizes = 16, 32, 48, 64, 128, 256

# Из набора берётся тёмный вариант: в системе значок один на все темы (Р-097),
# и тёмный читается и на светлой панели задач, и на тёмной.
function Read-Mark {
    param([int]$Size)

    $path = Join-Path $source "zeronote-dark-$Size.png"
    if (-not (Test-Path $path)) { throw "Нет исходника: $path" }

    $loaded = New-Object System.Drawing.Bitmap($path)
    try {
        if ($loaded.Width -ne $Size -or $loaded.Height -ne $Size) {
            throw "$path не $Size x $Size, а $($loaded.Width) x $($loaded.Height)"
        }

        # Перерисовка в известный формат: дальше мы читаем байты напрямую,
        # и порядок каналов должен быть тем, который ждёт BMP внутри .ico.
        # SourceCopy, а не наложение: альфа исходника переносится как есть.
        $copy = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($copy)
        $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $g.DrawImageUnscaled($loaded, 0, 0)
        $g.Dispose()
        return $copy
    }
    finally {
        $loaded.Dispose()
    }
}

function Get-Pixels {
    param([System.Drawing.Bitmap]$Bitmap)

    $rect = New-Object System.Drawing.Rectangle(0, 0, $Bitmap.Width, $Bitmap.Height)
    $data = $Bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        if ($data.Stride -ne $Bitmap.Width * 4) {
            throw "Неожиданный шаг строки: $($data.Stride)"
        }
        $bytes = [byte[]]::new($data.Stride * $Bitmap.Height)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        # Запятая перед массивом обязательна: без неё PowerShell разложит его
        # в поток отдельных байтов, и вызывающий получит не массив.
        return , $bytes
    }
    finally {
        $Bitmap.UnlockBits($data)
    }
}

# Кадр .ico размером меньше 256 хранится как BMP без заголовка файла.
function New-BitmapFrame {
    param([System.Drawing.Bitmap]$Bitmap)

    $w = $Bitmap.Width
    $h = $Bitmap.Height
    $pixels = Get-Pixels $Bitmap

    $stream = New-Object System.IO.MemoryStream
    $out = New-Object System.IO.BinaryWriter($stream)
    try {
        # BITMAPINFOHEADER. Высота удвоена, потому что за цветом идёт маска
        # прозрачности — формат считает их одной картинкой двойной высоты.
        $out.Write([int]40)
        $out.Write([int]$w)
        $out.Write([int]($h * 2))
        $out.Write([int16]1)
        $out.Write([int16]32)
        $out.Write([int]0)
        $out.Write([int]($w * $h * 4))
        $out.Write([int]0); $out.Write([int]0); $out.Write([int]0); $out.Write([int]0)

        # Цвет: BGRA, строки снизу вверх — так их хранит BMP.
        for ($y = $h - 1; $y -ge 0; $y--) {
            $out.Write($pixels, $y * $w * 4, $w * 4)
        }

        # Маска прозрачности: бит на пиксель, единица — «не рисовать».
        # У 32-битного значка прозрачность уже есть в альфа-канале, но маска
        # всё равно обязана быть: старые пути отрисовки читают только её.
        $maskRow = ([int][Math]::Ceiling($w / 32.0)) * 4
        for ($y = $h - 1; $y -ge 0; $y--) {
            $row = [byte[]]::new($maskRow)
            for ($x = 0; $x -lt $w; $x++) {
                if ($pixels[$y * $w * 4 + $x * 4 + 3] -lt 128) {
                    # Floor, а не [int]: приведение к целому округляет,
                    # и [int](12 / 8) даёт 2, а нужен номер байта — 1.
                    $byte = [int][Math]::Floor($x / 8)
                    $row[$byte] = $row[$byte] -bor (1 -shl (7 - ($x % 8)))
                }
            }
            $out.Write($row, 0, $maskRow)
        }

        $out.Flush()
        return , $stream.ToArray()
    }
    finally {
        $out.Dispose()
        $stream.Dispose()
    }
}

# Кадр 256 хранится картинкой PNG целиком: растром он весил бы четверть
# мегабайта против 25 КБ, и ради этого исключение в формат и вводили.
#
# Остальные кадры растровые, хотя PNG выгоднее и там (кадр 128 — 8,7 КБ против
# 67). Так решено после проверки: System.Drawing читает .ico с кадрами PNG
# мельче 256 с ошибкой, а 256 не видит вовсе. Оболочка Windows их понимает,
# но раз спотыкается разборщик такого возраста и распространённости, классическая
# раскладка стоит своих 70 КБ. Все размеры .ico целиком — 125 КБ.
function New-PngFrame {
    param([System.Drawing.Bitmap]$Bitmap)

    $stream = New-Object System.IO.MemoryStream
    try {
        $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return , $stream.ToArray()
    }
    finally {
        $stream.Dispose()
    }
}

$frames = @()
foreach ($size in $icoSizes) {
    $bitmap = Read-Mark $size
    try {
        $data = if ($size -eq 256) { New-PngFrame $bitmap } else { New-BitmapFrame $bitmap }
        $frames += [pscustomobject]@{ Size = $size; Data = $data }
    }
    finally {
        $bitmap.Dispose()
    }
}

$stream = New-Object System.IO.MemoryStream
$out = New-Object System.IO.BinaryWriter($stream)
try {
    # Заголовок: два нуля, тип 1 (значок, а не курсор), число кадров.
    $out.Write([int16]0)
    $out.Write([int16]1)
    $out.Write([int16]$frames.Count)

    # Оглавление: по 16 байт на кадр. Данные идут следом за ним подряд,
    # поэтому смещение считается накопительно.
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
        # Размер хранится одним байтом, поэтому 256 записывается нулём.
        $side = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
        $out.Write([byte]$side)
        $out.Write([byte]$side)
        $out.Write([byte]0)
        $out.Write([byte]0)
        $out.Write([int16]1)
        $out.Write([int16]32)
        $out.Write([int]$frame.Data.Length)
        $out.Write([int]$offset)
        $offset += $frame.Data.Length
    }

    foreach ($frame in $frames) {
        $out.Write($frame.Data, 0, $frame.Data.Length)
    }

    $out.Flush()
    $ico = Join-Path $target 'icon.ico'
    [System.IO.File]::WriteAllBytes($ico, $stream.ToArray())
    Write-Output "icon.ico: $($frames.Count) кадров, $((Get-Item $ico).Length) байт"
}
finally {
    $out.Dispose()
    $stream.Dispose()
}

# PNG копируются как есть, вместе с метаданными об их происхождении:
# перекодировать нечего, а имена размеров у Tauri свои.
$copies = @(
    @{ Size = 32;  Name = '32x32.png' }
    @{ Size = 64;  Name = '64x64.png' }
    @{ Size = 128; Name = '128x128.png' }
    @{ Size = 256; Name = '128x128@2x.png' }
    @{ Size = 512; Name = 'icon.png' }
)

foreach ($copy in $copies) {
    $from = Join-Path $source "zeronote-dark-$($copy.Size).png"
    if (-not (Test-Path $from)) { throw "Нет исходника: $from" }
    Copy-Item -LiteralPath $from -Destination (Join-Path $target $copy.Name) -Force
    Write-Output "$($copy.Name): из zeronote-dark-$($copy.Size).png"
}
