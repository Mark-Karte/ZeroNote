# Перетаскивание мышью внутри окна ZeroNote: нажать в одной точке, провести,
# отпустить в другой.
#
#   powershell -File bench\ui\drag.ps1 770 106 200 106
#
# Координаты — относительно левого верхнего угла окна, как у `click.ps1`.
# Путь проходится шагами: обработчику перетаскивания вкладок нужен порог
# в несколько пикселей и несколько событий движения, а прыжок из одной точки
# в другую он бы принял за щелчок. Заведён на этапе 11 для областей
# редактора: перетаскивание между областями иначе не проверить.
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class D {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

if ($args.Count -lt 4) { throw "нужны четыре числа: x1 y1 x2 y2" }

# Те же правила, что у click.ps1: одно окно, передний план с проверкой,
# окно прибито к началу экрана.
$found = @(Get-Process zeronote -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 })
if ($env:ZERONOTE_PID) { $found = @($found | Where-Object { $_.Id -eq [int]$env:ZERONOTE_PID }) }
if ($found.Count -gt 1) { throw "окон ZeroNote несколько: $(($found | ForEach-Object { $_.Id }) -join ', '). Задайте ZERONOTE_PID" }
$proc = $found | Select-Object -First 1
if (-not $proc) { throw "окно ZeroNote не найдено" }
$hwnd = $proc.MainWindowHandle

[D]::keybd_event(0x12, 0, 0, [IntPtr]::Zero)
[D]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)
$mine = [D]::GetCurrentThreadId()
$theirs = [D]::GetWindowThreadProcessId($hwnd, [IntPtr]::Zero)
[void][D]::AttachThreadInput($mine, $theirs, $true)
[void][D]::SetForegroundWindow($hwnd)
[void][D]::AttachThreadInput($mine, $theirs, $false)
Start-Sleep -Milliseconds 400
if ([D]::GetForegroundWindow() -ne $hwnd) { throw "окно не вышло на передний план" }

$r = New-Object D+RECT
[void][D]::GetWindowRect($hwnd, [ref]$r)
if ($r.Left -ne 0 -or $r.Top -ne 0) {
  [void][D]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, 0, 0, 0x0015)
  Start-Sleep -Milliseconds 700
} else {
  Start-Sleep -Milliseconds 200
}
[void][D]::GetWindowRect($hwnd, [ref]$r)

$x1 = $r.Left + [int]$args[0]
$y1 = $r.Top + [int]$args[1]
$x2 = $r.Left + [int]$args[2]
$y2 = $r.Top + [int]$args[3]

[void][D]::SetCursorPos($x1, $y1)
Start-Sleep -Milliseconds 150
# 0x0002 — левая кнопка вниз, 0x0004 — вверх.
[D]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 120

# Двадцать шагов с паузой: обработчик смотрит на каждое движение отдельно
# и переставляет вкладку не дальше чем на одно место за шаг.
$steps = 20
for ($i = 1; $i -le $steps; $i++) {
  $x = [int]($x1 + ($x2 - $x1) * $i / $steps)
  $y = [int]($y1 + ($y2 - $y1) * $i / $steps)
  [void][D]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 40
}

Start-Sleep -Milliseconds 120
[D]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 600
Write-Output "проведено из ($x1, $y1) в ($x2, $y2)"
