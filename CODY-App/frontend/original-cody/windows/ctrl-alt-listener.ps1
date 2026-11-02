# Watches voice modifiers and mouse presses; Electron owns the Ctrl+Alt+C shortcut.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodyModifierKeys {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int virtualKey);
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X; public int Y; }
    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out Point point);
}
'@
$held = $false
$chatChord = $false
$mouseHeld = $false
try {
    while ($true) {
        $leftMouse = ((([int][CodyModifierKeys]::GetAsyncKeyState(0x01)) -band 0x8000) -ne 0)
        $rightMouse = ((([int][CodyModifierKeys]::GetAsyncKeyState(0x02)) -band 0x8000) -ne 0)
        $mouse = ((([int][CodyModifierKeys]::GetAsyncKeyState(0x01)) -band 0x8000) -ne 0) -or ((([int][CodyModifierKeys]::GetAsyncKeyState(0x02)) -band 0x8000) -ne 0) -or ((([int][CodyModifierKeys]::GetAsyncKeyState(0x04)) -band 0x8000) -ne 0)
        if ($mouse -and -not $mouseHeld) {
            $point = New-Object CodyModifierKeys+Point
            if ([CodyModifierKeys]::GetCursorPos([ref]$point)) { $button = if ($leftMouse) { 'left' } elseif ($rightMouse) { 'right' } else { 'middle' }; [Console]::Out.WriteLine(('CLICK {0} {1} {2}' -f $point.X,$point.Y,$button)); [Console]::Out.Flush() }
        }
        $mouseHeld = $mouse
        $ctrl = (([int][CodyModifierKeys]::GetAsyncKeyState(0x11)) -band 0x8000) -ne 0
        $alt = (([int][CodyModifierKeys]::GetAsyncKeyState(0x12)) -band 0x8000) -ne 0
        # AltGr often appears as Ctrl+Alt; do not turn ordinary typing into recording.
        $altGr = (([int][CodyModifierKeys]::GetAsyncKeyState(0xA5)) -band 0x8000) -ne 0
        $both = $ctrl -and $alt -and -not $altGr
        $chatKey = (([int][CodyModifierKeys]::GetAsyncKeyState(0x43)) -band 0x8000) -ne 0
        if (-not $both) { $chatChord = $false }
        if ($both -and $chatKey -and -not $chatChord) {
            $chatChord = $true
            $held = $false
            [Console]::Out.WriteLine('CANCEL')
            [Console]::Out.Flush()
        }
        # Do not submit voice or restart capture while this chat chord is held.
        if ($chatChord) { Start-Sleep -Milliseconds 25; continue }
        if ($both -ne $held) {
            $held = $both
            if ($held) { [Console]::Out.WriteLine('DOWN') }
            else { [Console]::Out.WriteLine('UP') }
            [Console]::Out.Flush()
        }
        Start-Sleep -Milliseconds 25
    }
} finally {
    if ($held) { [Console]::Out.WriteLine('UP'); [Console]::Out.Flush() }
}
