# Прокрутка колесом в окне ZeroNote.
#
#   powershell -File bench\ui\scroll.ps1 600 400 -8    # вниз на восемь щелчков
#   powershell -File bench\ui\scroll.ps1 600 400  4    # вверх на четыре
#
# Понадобился на приёмке этапа 10: у окна параметров содержимое длиннее экрана,
# и кнопка «Обновления» лежит под сгибом. Клавишами её не достать — прокручивается
# не документ, а вложенная область, и фокуса у неё нет.
#
# Устройство то же, что у click.ps1: передний план через AttachThreadInput
# с проверкой, окно прибивается к началу экрана, координаты — от угла окна.
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class S {
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

$found = @(Get-Process zeronote -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 })
if ($env:ZERONOTE_PID) { $found = @($found | Where-Object { $_.Id -eq [int]$env:ZERONOTE_PID }) }
if ($found.Count -gt 1) { throw "окон ZeroNote несколько: $(($found | ForEach-Object { $_.Id }) -join ', '). Задайте ZERONOTE_PID" }
$proc = $found | Select-Object -First 1
if (-not $proc) { throw "окно ZeroNote не найдено" }
$hwnd = $proc.MainWindowHandle

[S]::keybd_event(0x12, 0, 0, [IntPtr]::Zero)
[S]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)
$mine = [S]::GetCurrentThreadId()
$theirs = [S]::GetWindowThreadProcessId($hwnd, [IntPtr]::Zero)
[void][S]::AttachThreadInput($mine, $theirs, $true)
[void][S]::SetForegroundWindow($hwnd)
[void][S]::AttachThreadInput($mine, $theirs, $false)
Start-Sleep -Milliseconds 400
if ([S]::GetForegroundWindow() -ne $hwnd) { throw "окно не вышло на передний план" }

$r = New-Object S+RECT
[void][S]::GetWindowRect($hwnd, [ref]$r)
if ($r.Left -ne 0 -or $r.Top -ne 0) {
  [void][S]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, 0, 0, 0x0015)
  Start-Sleep -Milliseconds 700
} else {
  Start-Sleep -Milliseconds 200
}

[void][S]::GetWindowRect($hwnd, [ref]$r)
$x = $r.Left + [int]$args[0]
$y = $r.Top + [int]$args[1]
$notches = if ($args.Count -gt 2) { [int]$args[2] } else { -3 }

# Курсор ставится до прокрутки: колесо достаётся окну под указателем,
# а не тому, у кого фокус.
[void][S]::SetCursorPos($x, $y)
Start-Sleep -Milliseconds 150

# 0x0800 MOUSEEVENTF_WHEEL, 120 — один щелчок колеса (WHEEL_DELTA).
# Щелчки шлются по одному: одним вызовом на всю величину плавную прокрутку
# вебвью иногда съедает целиком.
#
# Отрицательная величина переводится в uint вычитанием, а не маской: в PS 5.1
# `0xFFFFFFFF` — это Int32 −1, поэтому `-120 -band 0xFFFFFFFF` даёт −120,
# а `[uint32](-120)` падает. Первая версия скрипта так и делала — и падение
# было **не видно**: ошибка непрерывающая, цикл шёл дальше, и скрипт бодро
# печатал «прокручено», не прокрутив ничего. Ровно тот случай, про который
# написано в README: проверка, которая не может сработать, выглядит так же,
# как сработавшая. Отсюда и `-ErrorAction Stop` ниже.
$delta = if ($notches -lt 0) { [uint32](4294967296 - 120) } else { [uint32]120 }
for ($i = 0; $i -lt [Math]::Abs($notches); $i++) {
  [S]::mouse_event(0x0800, 0, 0, $delta, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
}
Start-Sleep -Milliseconds 400
Write-Output "прокручено в ($x, $y) на $notches щелчков"
