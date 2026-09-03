# Щелчок по координатам внутри окна ZeroNote.
#
# Координаты — относительно левого верхнего угла окна, в той же системе,
# в которой снят PrintWindow-снимок. Совпадение это не гарантия: после щелчка
# обязательно снимаем экран и смотрим, попали ли.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class C {
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

$proc = Get-Process zeronote -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "окно ZeroNote не найдено" }
$hwnd = $proc.MainWindowHandle

[C]::keybd_event(0x12, 0, 0, [IntPtr]::Zero)
[C]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)
$mine = [C]::GetCurrentThreadId()
$theirs = [C]::GetWindowThreadProcessId($hwnd, [IntPtr]::Zero)
[void][C]::AttachThreadInput($mine, $theirs, $true)
[void][C]::SetForegroundWindow($hwnd)
[void][C]::AttachThreadInput($mine, $theirs, $false)
Start-Sleep -Milliseconds 400
if ([C]::GetForegroundWindow() -ne $hwnd) { throw "окно не вышло на передний план" }

# Прибиваем окно к началу экрана. Между вызовами оно переезжает, и координаты,
# посчитанные от прошлого положения, попадают мимо. Проверка «щёлкнуть и снять
# экран» это ловит, но чинить каждый раз руками — не дело.
# 0x0001 SWP_NOSIZE | 0x0004 SWP_NOZORDER | 0x0010 SWP_NOACTIVATE
[void][C]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, 0, 0, 0x0015)
Start-Sleep -Milliseconds 200

$r = New-Object C+RECT
[void][C]::GetWindowRect($hwnd, [ref]$r)
$x = $r.Left + [int]$args[0]
$y = $r.Top + [int]$args[1]

# Третий аргумент — держать ли Ctrl во время щелчка.
# Модификатор третьим аргументом: ctrl — переход по ссылке, alt — второй курсор.
$ctrl = ($args.Count -gt 2) -and ($args[2] -eq 'ctrl')
$alt = ($args.Count -gt 2) -and ($args[2] -eq 'alt')

[void][C]::SetCursorPos($x, $y)
Start-Sleep -Milliseconds 150
if ($ctrl) { [C]::keybd_event(0x11, 0, 0, [IntPtr]::Zero) }
if ($alt) { [C]::keybd_event(0x12, 0, 0, [IntPtr]::Zero) }
[C]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
[C]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
if ($ctrl) { [C]::keybd_event(0x11, 0, 2, [IntPtr]::Zero) }
if ($alt) { [C]::keybd_event(0x12, 0, 2, [IntPtr]::Zero) }
Start-Sleep -Milliseconds 600
Write-Output "щёлкнуто в ($x, $y)"
