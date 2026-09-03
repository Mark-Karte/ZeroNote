# Снимок окна через PrintWindow: не требует переднего плана.
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class P {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# Окон ZeroNote может быть два: установленное и собранное для отладки.
# Первое попавшееся брать нельзя — нажатия ушли бы в чужое окно, и понять
# это можно было бы только по снимку. Номер процесса задаётся переменной
# окружения ZERONOTE_PID; без неё двусмысленность считается ошибкой.
$found = @(Get-Process zeronote -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 })
if ($env:ZERONOTE_PID) { $found = @($found | Where-Object { $_.Id -eq [int]$env:ZERONOTE_PID }) }
if ($found.Count -gt 1) { throw "окон ZeroNote несколько: $(($found | ForEach-Object { $_.Id }) -join ', '). Задайте ZERONOTE_PID" }
$proc = $found | Select-Object -First 1
if (-not $proc) { throw "окно ZeroNote не найдено" }
$hwnd = $proc.MainWindowHandle

$r = New-Object P+RECT
[void][P]::GetWindowRect($hwnd, [ref]$r)
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
# 0x2 — PW_RENDERFULLCONTENT: без него содержимое WebView2 не попадает в снимок.
$ok = [P]::PrintWindow($hwnd, $dc, 2)
$g.ReleaseHdc($dc)
if (-not $ok) { throw "PrintWindow не сработал" }
$bmp.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "снято ${w}x${h}"
