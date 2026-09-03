# Отправить нажатия в окно ZeroNote.
#
# Три урока, оплаченных отладкой:
#
# 1. Передний план из фонового процесса Windows блокирует. Забираем его через
#    AttachThreadInput и ПРОВЕРЯЕМ результат — без проверки нажатия уходят
#    в чужое окно.
# 2. Переднего плана мало. WebView2 держит содержимое в дочернем окне, и пока
#    щелчка внутрь не было, фокус клавиатуры остаётся на рамке: нажатия
#    приходят в приложение и не доходят до вебвью. Поэтому сначала щелчок.
# 3. А иногда щелчок портит дело: в центре окна лежит текст, и щелчок туда
#    двигает курсор, а если открыта палитра — закрывает её. Поэтому -At:
#    щёлкнуть можно ровно туда, куда нужно. И -NoClick — не щёлкать вовсе.
#
#    ВАЖНО про -NoClick: он надёжен только пока с прошлого щелчка никто
#    не забирал передний план. Каждый запуск powershell мигает своим окном
#    консоли, фокус внутри приложения возвращается на рамку, и нажатия
#    до вебвью не доходят — молча. Между вызовами -NoClick не работает;
#    если нужно несколько нажатий подряд, передавайте их одним вызовом.
param(
    [switch]$NoClick,
    # Куда щёлкнуть перед вводом: "x,y" в координатах окна. По умолчанию —
    # середина рабочей области.
    [string]$At = '',
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Keys
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class K {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process zeronote -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "окно ZeroNote не найдено" }
$hwnd = $proc.MainWindowHandle

# Windows отдаёт передний план охотнее, если только что был ввод с клавиатуры.
[K]::keybd_event(0x12, 0, 0, [IntPtr]::Zero)
[K]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)

$mine = [K]::GetCurrentThreadId()
$theirs = [K]::GetWindowThreadProcessId($hwnd, [IntPtr]::Zero)
[void][K]::AttachThreadInput($mine, $theirs, $true)
[void][K]::SetForegroundWindow($hwnd)
[void][K]::AttachThreadInput($mine, $theirs, $false)
Start-Sleep -Milliseconds 400

if ([K]::GetForegroundWindow() -ne $hwnd) { throw "окно не вышло на передний план" }

# Щелчок в рабочую область — правее боковой панели, ниже заголовка.
if (-not $NoClick) {
    $r = New-Object K+RECT
    [void][K]::GetWindowRect($hwnd, [ref]$r)
    if ($At -ne '') {
        $parts = $At.Split(',')
        $x = $r.Left + [int]$parts[0]
        $y = $r.Top + [int]$parts[1]
    } else {
        $x = [int](($r.Left + $r.Right) / 2 + 150)
        $y = [int](($r.Top + $r.Bottom) / 2)
    }
    [void][K]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 150
    [K]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    [K]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 300
}

foreach ($keys in $Keys) {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
    Start-Sleep -Milliseconds 400
}
Write-Output 'отправлено'
