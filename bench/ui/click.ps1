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
#
# Двигаем только если оно и правда не на месте, и после перемещения ждём
# дольше обычного: WebView2 держит содержимое в дочернем окне и узнаёт о новом
# положении не мгновенно. Щелчок, посланный слишком рано, приходит в вебвью
# с координатами от прежнего места — и всё, что открывается по щелчку,
# появляется ровно на столько же в стороне. Проверено: окно стояло в (52,150),
# меню вышло на 52 левее и на 150 выше точки.
$r = New-Object C+RECT
[void][C]::GetWindowRect($hwnd, [ref]$r)
if ($r.Left -ne 0 -or $r.Top -ne 0) {
  # 0x0001 SWP_NOSIZE | 0x0004 SWP_NOZORDER | 0x0010 SWP_NOACTIVATE
  [void][C]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, 0, 0, 0x0015)
  Start-Sleep -Milliseconds 700
} else {
  Start-Sleep -Milliseconds 200
}

# Положение перечитывается: выше его могли изменить.
[void][C]::GetWindowRect($hwnd, [ref]$r)
$x = $r.Left + [int]$args[0]
$y = $r.Top + [int]$args[1]

# Третий аргумент — чем щёлкнуть и с чем.
# ctrl — переход по ссылке, alt — второй курсор, right — контекстное меню.
$ctrl = ($args.Count -gt 2) -and ($args[2] -eq 'ctrl')
$alt = ($args.Count -gt 2) -and ($args[2] -eq 'alt')
$right = ($args.Count -gt 2) -and ($args[2] -eq 'right')

# 0x0002/0x0004 — левая кнопка вниз и вверх, 0x0008/0x0010 — правая.
$down = if ($right) { 0x0008 } else { 0x0002 }
$up = if ($right) { 0x0010 } else { 0x0004 }

[void][C]::SetCursorPos($x, $y)
Start-Sleep -Milliseconds 150
if ($ctrl) { [C]::keybd_event(0x11, 0, 0, [IntPtr]::Zero) }
if ($alt) { [C]::keybd_event(0x12, 0, 0, [IntPtr]::Zero) }
[C]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
[C]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
if ($ctrl) { [C]::keybd_event(0x11, 0, 2, [IntPtr]::Zero) }
if ($alt) { [C]::keybd_event(0x12, 0, 2, [IntPtr]::Zero) }
Start-Sleep -Milliseconds 600
Write-Output "щёлкнуто в ($x, $y)"
