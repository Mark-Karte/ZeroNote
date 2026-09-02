# Навести указатель, не нажимая. Кнопки в дереве появляются на наведении.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class H {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process zeronote -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$hwnd = $proc.MainWindowHandle

[H]::keybd_event(0x12, 0, 0, [IntPtr]::Zero)
[H]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)
$mine = [H]::GetCurrentThreadId()
$theirs = [H]::GetWindowThreadProcessId($hwnd, [IntPtr]::Zero)
[void][H]::AttachThreadInput($mine, $theirs, $true)
[void][H]::SetForegroundWindow($hwnd)
[void][H]::AttachThreadInput($mine, $theirs, $false)

$r = New-Object H+RECT
[void][H]::GetWindowRect($hwnd, [ref]$r)
[void][H]::SetCursorPos(($r.Left + [int]$args[0]), ($r.Top + [int]$args[1]))
Start-Sleep -Milliseconds 500
Write-Output "наведено"
