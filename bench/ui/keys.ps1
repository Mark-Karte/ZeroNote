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
#
# 4. -At задаётся ТОЛЬКО по имени. Без Position у нажатий он забирал нулевую
#    позицию, и вызов вида keys.ps1 "^w" уезжал в координаты: скрипт ругался
#    на разбор числа и всё равно печатал «отправлено». Position = 0 у Keys
#    делает -At именованным, а ValidatePattern не даёт принять за координаты
#    что попало.
# 5. SendKeys шлёт нажатия БЕЗ скан-кода, и это ломает ровно то, ради чего
#    стенд заводился. Скан-код — то, из чего Chromium делает event.code,
#    а вся наша раскладка построена на нём: без него Alt+Shift+0 приезжает
#    как ")" и не совпадает ни с чем, а Ctrl+C вообще не превращается
#    в команду копирования. Поэтому сочетания шлются через -Chord, который
#    добывает скан-код сам. Текст и одиночные клавиши по-прежнему через
#    SendKeys: там скан-код не нужен.
param(
    [switch]$NoClick,
    # Куда щёлкнуть перед вводом: "x,y" в координатах окна. По умолчанию —
    # середина рабочей области.
    [ValidatePattern('^$|^\d+,\d+$')]
    [string]$At = '',
    # Сочетание в том же виде, в каком оно пишется в keymap.toml:
    # "ctrl+shift+p", "alt+0", "f12". Несколько — через запятую.
    [string]$Chord = '',
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
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
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
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

# Имена клавиш из keymap.toml в виртуальные коды Windows. Буквы и цифры
# считаются по формуле, здесь только именованные.
$named = @{
    'enter' = 0x0D; 'tab' = 0x09; 'escape' = 0x1B; 'space' = 0x20
    'backspace' = 0x08; 'delete' = 0x2E; 'insert' = 0x2D
    'home' = 0x24; 'end' = 0x23; 'pageup' = 0x21; 'pagedown' = 0x22
    'left' = 0x25; 'up' = 0x26; 'right' = 0x27; 'down' = 0x28
    # Знаки препинания названы по положению клавиши — так же, как в раскладке
    # приложения (Р-121). Коды здесь американские: виртуальный код клавиши
    # от раскладки не зависит, зависит только нанесённый на неё знак.
    'comma' = 0xBC; 'period' = 0xBE; 'slash' = 0xBF; 'backslash' = 0xDC
    'bracketleft' = 0xDB; 'bracketright' = 0xDD; 'semicolon' = 0xBA
    'quote' = 0xDE; 'backquote' = 0xC0; 'minus' = 0xBD; 'equal' = 0xBB
}
# Клавиши «расширенного» набора требуют своего флага, иначе система примет
# стрелку за цифру дополнительной клавиатуры.
$extended = @(0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28)

function Send-Key([int]$vk, [bool]$up) {
    # Скан-код добывается по виртуальному: без него нажатие приходит
    # в вебвью с пустым event.code.
    $scan = [K]::MapVirtualKey([uint32]$vk, 0)
    $flags = 0
    if ($extended -contains $vk) { $flags = $flags -bor 0x0001 }
    if ($up) { $flags = $flags -bor 0x0002 }
    [K]::keybd_event([byte]$vk, [byte]$scan, [uint32]$flags, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 30
}

function Send-Chord([string]$chord) {
    $ctrl = $false; $alt = $false; $shift = $false; $vk = 0
    foreach ($part in $chord.Split('+')) {
        switch ($part.Trim().ToLower()) {
            'ctrl' { $ctrl = $true }
            'control' { $ctrl = $true }
            'alt' { $alt = $true }
            'shift' { $shift = $true }
            default {
                $name = $_
                if ($named.ContainsKey($name)) { $vk = $named[$name] }
                elseif ($name -match '^f(\d{1,2})$') { $vk = 0x6F + [int]$Matches[1] }
                elseif ($name -match '^[a-z]$') { $vk = [int][char]$name.ToUpper() }
                elseif ($name -match '^[0-9]$') { $vk = 0x30 + [int]$name }
                else { throw "не понимаю клавишу: $name" }
            }
        }
    }
    if ($vk -eq 0) { throw "в сочетании нет клавиши: $chord" }

    if ($ctrl) { Send-Key 0x11 $false }
    if ($alt) { Send-Key 0x12 $false }
    if ($shift) { Send-Key 0x10 $false }
    Send-Key $vk $false
    Send-Key $vk $true
    if ($shift) { Send-Key 0x10 $true }
    if ($alt) { Send-Key 0x12 $true }
    if ($ctrl) { Send-Key 0x11 $true }
}

if ($Chord -ne '') {
    foreach ($one in $Chord.Split(',')) {
        Send-Chord $one.Trim()
        Start-Sleep -Milliseconds 400
    }
}

foreach ($keys in $Keys) {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
    Start-Sleep -Milliseconds 400
}
Write-Output 'отправлено'
