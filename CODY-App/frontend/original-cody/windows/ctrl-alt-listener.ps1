# Watches voice modifiers and pointer presses; Electron owns the Ctrl+Alt shortcuts.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
public static class CodyModifierKeys {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int virtualKey);
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput { public Point point; public uint mouseData, flags, time; public UIntPtr extraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Message { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public Point point; public uint privateData; }
    private delegate IntPtr MouseHook(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SetWindowsHookEx(int id, MouseHook callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
    private static readonly ConcurrentQueue<string> presses = new ConcurrentQueue<string>();
    private static readonly MouseHook callback = OnMouse;
    private static readonly MouseHook keyboardCallback = OnKeyboard;
    private static bool altGrHeld, altGrUsed;
    private static uint altGrStarted;
    private static IntPtr OnKeyboard(int code, IntPtr message, IntPtr data) {
        if (code >= 0) {
            int key = Marshal.ReadInt32(data), kind = message.ToInt32();
            uint flags = unchecked((uint)Marshal.ReadInt32(data, 8));
            uint time = unchecked((uint)Marshal.ReadInt32(data, 12));
            bool down = kind == 0x0100 || kind == 0x0104;
            bool up = kind == 0x0101 || kind == 0x0105;
            if (key == 0x48 && up) presses.Enqueue("VISIBILITY_RELEASE");
            // Only physical taps: automation must never send a quick message.
            if ((flags & 0x10) == 0) {
                if (key == 0xA5) {
                    if (down && !altGrHeld) {
                        altGrHeld = true; altGrUsed = false; altGrStarted = time;
                        // Ctrl may be synthesized by Windows for AltGr.
                        for (int vk = 8; vk < 255; vk++) {
                            if (vk == 0x11 || vk == 0x12 || vk == 0xA2 || vk == 0xA3 || vk == 0xA5) continue;
                            if ((GetAsyncKeyState(vk) & 0x8000) != 0) { altGrUsed = true; break; }
                        }
                    }
                    if (up && altGrHeld) {
                        if (!altGrUsed && unchecked(time - altGrStarted) <= 700) presses.Enqueue("ALTGR_TAP");
                        altGrHeld = false;
                    }
                } else if (down && altGrHeld) altGrUsed = true;
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }
    private static readonly ManualResetEvent ready = new ManualResetEvent(false);
    private static Thread watcher;
    private static uint threadId;
    private static int startupError;
    private static IntPtr OnMouse(int code, IntPtr message, IntPtr data) {
        int kind = message.ToInt32();
        if (code >= 0 && (kind == 0x0201 || kind == 0x0204 || kind == 0x0207)) {
            // Include touch/pen promoted presses, even when Windows marks them injected.
            // Queue only: never block input delivery while writing to the parent process.
            MouseInput input = (MouseInput)Marshal.PtrToStructure(data, typeof(MouseInput));
            presses.Enqueue(String.Format("POINTER {0} {1} {2}", input.point.X, input.point.Y,
                kind == 0x0201 ? "left" : kind == 0x0204 ? "right" : "middle"));
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }
    public static void StartPointerWatch() {
        ready.Reset(); startupError = 0;
        watcher = new Thread(() => {
            SetThreadDpiAwarenessContext(new IntPtr(-4));
            threadId = GetCurrentThreadId();
            IntPtr hook = SetWindowsHookEx(14, callback, GetModuleHandle(null), 0);
            if (hook == IntPtr.Zero) startupError = Marshal.GetLastWin32Error();
            IntPtr keyboardHook = SetWindowsHookEx(13, keyboardCallback, GetModuleHandle(null), 0);
            if (keyboardHook == IntPtr.Zero) startupError = Marshal.GetLastWin32Error();
            ready.Set();
            if (startupError != 0) {
                if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
                if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
                return;
            }
            try { Message message; while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {} }
            finally { UnhookWindowsHookEx(hook); UnhookWindowsHookEx(keyboardHook); }
        });
        watcher.IsBackground = true;
        watcher.Start(); ready.WaitOne();
        if (startupError != 0) throw new Win32Exception(startupError);
    }
    public static string NextPointerPress() { string press; return presses.TryDequeue(out press) ? press : null; }
    public static void StopPointerWatch() {
        if (watcher == null || !watcher.IsAlive) return;
        PostThreadMessage(threadId, 0x0012, UIntPtr.Zero, IntPtr.Zero);
        watcher.Join(1000);
    }
}
'@
$held = $false
$shortcutChord = $false
$muteKeyHeld = $false
[CodyModifierKeys]::StartPointerWatch()
try {
    while ($true) {
        while ($press = [CodyModifierKeys]::NextPointerPress()) {
            [Console]::Out.WriteLine($press); [Console]::Out.Flush()
        }
        $ctrl = (([int][CodyModifierKeys]::GetAsyncKeyState(0x11)) -band 0x8000) -ne 0
        $alt = (([int][CodyModifierKeys]::GetAsyncKeyState(0x12)) -band 0x8000) -ne 0
        # AltGr often appears as Ctrl+Alt; do not turn ordinary typing into recording.
        $altGr = (([int][CodyModifierKeys]::GetAsyncKeyState(0xA5)) -band 0x8000) -ne 0
        $both = $ctrl -and $alt -and -not $altGr
        $chatKey = (([int][CodyModifierKeys]::GetAsyncKeyState(0x43)) -band 0x8000) -ne 0
        $muteKey = (([int][CodyModifierKeys]::GetAsyncKeyState(0x4D)) -band 0x8000) -ne 0
        $visibilityKey = (([int][CodyModifierKeys]::GetAsyncKeyState(0x48)) -band 0x8000) -ne 0
        if ($muteKeyHeld -and -not $muteKey) { [Console]::Out.WriteLine('MUTE_RELEASE'); [Console]::Out.Flush() }
        $muteKeyHeld = $muteKey
        if (-not $both) { $shortcutChord = $false }
        if ($both -and ($chatKey -or $muteKey -or $visibilityKey) -and -not $shortcutChord) {
            $shortcutChord = $true
            $held = $false
            [Console]::Out.WriteLine('CANCEL')
            [Console]::Out.Flush()
        }
        # App shortcuts suppress voice until the modifiers are released.
        if ($shortcutChord) { Start-Sleep -Milliseconds 25; continue }
        if ($both -ne $held) {
            $held = $both
            if ($held) { [Console]::Out.WriteLine('DOWN') }
            else { [Console]::Out.WriteLine('UP') }
            [Console]::Out.Flush()
        }
        Start-Sleep -Milliseconds 25
    }
} finally {
    [CodyModifierKeys]::StopPointerWatch()
    if ($held) { [Console]::Out.WriteLine('UP'); [Console]::Out.Flush() }
}
