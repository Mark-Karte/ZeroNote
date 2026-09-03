# Проверяет, что в собранном exe лежит наш значок, и показывает его кадры.
#
#   powershell -File icons\check-icon.ps1 src-tauri\target\release\zeronote.exe
#
# Зачем отдельная проверка. Значок попадает в exe ресурсом через build.rs,
# а cargo не считает icon.ico входом сборки: обновлённый набор молча не доедет,
# и .ico при этом останется правильным. Один раз так и вышло.
#
# Чего проверка НЕ делает: не пересчитывает кадры в exe. Windows дорисовывает
# любой запрошенный размер — просьба о кадре, которого нет, всё равно вернёт
# картинку ровно этого размера. Поэтому набор кадров считается по .ico,
# а у exe спрашивается совпадение пикселей: разошлись — значит сборка взяла
# старый ресурс.

#requires -Version 5.1
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Exe,
    [string]$Ico = '',
    [string]$Out = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IconProbe {
  // PrivateExtractIcons, в отличие от ExtractAssociatedIcon, умеет спрашивать
  // конкретный размер: иначе мы бы всегда получали 32 и не знали про остальные.
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, int[] ids, int count, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h);
}
"@

$exePath = (Resolve-Path -LiteralPath $Exe).Path
if ($Ico -eq '') { $Ico = Join-Path $PSScriptRoot '..\src-tauri\icons\icon.ico' }
$icoPath = (Resolve-Path -LiteralPath $Ico).Path
if ($Out -eq '') { $Out = Join-Path (Split-Path -Parent $exePath) 'icon-frames.png' }

# --- Что лежит в .ico ---------------------------------------------------

$bytes = [System.IO.File]::ReadAllBytes($icoPath)
if ([BitConverter]::ToUInt16($bytes, 2) -ne 1) { throw "$icoPath — не значок" }

$count = [BitConverter]::ToUInt16($bytes, 4)
$frames = @()
$expected = 6 + 16 * $count

for ($i = 0; $i -lt $count; $i++) {
    $entry = 6 + 16 * $i
    # Размер хранится одним байтом, и 256 записан нулём.
    $side = if ($bytes[$entry] -eq 0) { 256 } else { [int]$bytes[$entry] }
    $length = [BitConverter]::ToInt32($bytes, $entry + 8)
    $offset = [BitConverter]::ToInt32($bytes, $entry + 12)

    if ($offset -ne $expected) { throw "Кадр $side лежит по $offset, а данные идут с $expected" }
    if ($offset + $length -gt $bytes.Length) { throw "Кадр $side выходит за конец файла" }

    $png = $bytes[$offset] -eq 0x89 -and $bytes[$offset + 1] -eq 0x50
    $frames += [pscustomobject]@{ Size = $side; Png = $png }
    $expected += $length
}

if ($expected -ne $bytes.Length) { throw "После последнего кадра осталось $($bytes.Length - $expected) байт" }

$list = ($frames | ForEach-Object { if ($_.Png) { "$($_.Size) png" } else { "$($_.Size)" } }) -join ', '
Write-Output "$(Split-Path -Leaf $icoPath): $count кадров — $list"

# --- Тот ли значок попал в exe -------------------------------------------

# 256 сюда не берём: System.Drawing не читает кадры, хранимые картинкой PNG,
# и сравнить их этим способом не выйдет. Совпадения растровых кадров хватает,
# чтобы отличить свежий ресурс от старого.
$comparable = $frames | Where-Object { -not $_.Png } | ForEach-Object { $_.Size }

$sheet = New-Object System.Drawing.Bitmap(300, 148, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$paint = [System.Drawing.Graphics]::FromImage($sheet)
# Пурпур: на нём сразу видно и промах по каналам, и дырявую маску прозрачности.
$paint.Clear([System.Drawing.Color]::FromArgb(255, 220, 40, 220))

$x = 8
foreach ($size in $comparable) {
    $handles = New-Object IntPtr[] 1
    $ids = New-Object int[] 1
    $found = [IconProbe]::PrivateExtractIcons($exePath, 0, $size, $size, $handles, $ids, 1, 0)
    if ($found -lt 1) { throw "В $exePath нет значка вовсе" }

    $fromExe = [System.Drawing.Icon]::FromHandle($handles[0])
    $left = $fromExe.ToBitmap()
    $fromIco = New-Object System.Drawing.Icon($icoPath, (New-Object System.Drawing.Size($size, $size)))
    $right = $fromIco.ToBitmap()
    try {
        for ($y = 0; $y -lt $size; $y++) {
            for ($col = 0; $col -lt $size; $col++) {
                if ($left.GetPixel($col, $y).ToArgb() -ne $right.GetPixel($col, $y).ToArgb()) {
                    throw "Кадр $size в exe не совпал с .ico в точке ($col, $y): сборка взяла старый ресурс. Тронуть src-tauri\build.rs и собрать заново."
                }
            }
        }
        $paint.DrawImageUnscaled($left, $x, 8)
        $x += $size + 8
    }
    finally {
        $left.Dispose(); $right.Dispose()
        $fromExe.Dispose(); $fromIco.Dispose()
        [void][IconProbe]::DestroyIcon($handles[0])
    }
}

$paint.Dispose()
$sheet.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
Write-Output "Кадры $($comparable -join ', ') в exe совпали с .ico: $Out"
