using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using HeyClicky.Platform.Win32;

namespace HeyClicky.App.Cody;

// The Electron Island is a different process from the native engine. Neither
// process is the document being explained, even while its composer has focus.
internal static class CodyDrawingOwner
{
    private sealed record Window(nint Handle, int Pid);
    private static readonly object gate = new();
    private static readonly List<Window> recent = new();
    private static int clientPid;

    internal static void Start()
    {
        ForegroundTracker.ExternalWindowCameForward += Remember;
        Remember(GetForegroundWindow());
    }

    internal static void Client(int pid)
    {
        Volatile.Write(ref clientPid, pid);
        lock (gate) recent.RemoveAll(window => window.Pid == pid);
        Remember(GetForegroundWindow());
    }

    internal static bool Own(int pid) => pid == Environment.ProcessId || pid == Volatile.Read(ref clientPid);
    private static nint Root(nint window) => GetAncestor(window, 3);
    private static nint Front()
    {
        // The dedicated foreground-event thread has a live message pump.
        // Composition/accessibility worker threads can observe stale input
        // state across capture and cross-process activation.
        nint tracked = ForegroundTracker.LastExternalWindow;
        return Root(tracked != 0 && IsWindow(tracked) ? tracked : GetForegroundWindow());
    }
    internal static nint ForegroundWindow => Front();
    private static int Pid(nint window) { GetWindowThreadProcessId(window, out int pid); return pid; }
    private static void Remember(nint window)
    {
        window = Root(window);
        int pid = Pid(window);
        if (window == 0 || pid == 0 || Own(pid)) return;
        lock (gate)
        {
            // Client registration can race the foreground-event callback.
            if (Own(pid)) return;
            recent.RemoveAll(item => item.Handle == window);
            recent.Insert(0, new Window(window, pid));
            if (recent.Count > 16) recent.RemoveAt(16);
        }
    }

    private static Window Last()
    {
        Window window;
        lock (gate) window = recent.Count == 0 ? null : recent[0];
        // Validate both handle and process; Windows can recycle an HWND.
        return window != null && !Own(window.Pid) && IsWindow(window.Handle) &&
            Pid(window.Handle) == window.Pid ? window : null;
    }

    internal static ForegroundApp Capture()
    {
        nint front = Front();
        int pid = Pid(front);
        Window target;
        if (front != 0 && pid != 0 && !Own(pid))
        {
            Remember(front);
            target = new Window(front, pid);
        }
        else target = Last();
        if (target == null || IsIconic(target.Handle) || !IsWindowVisible(target.Handle)) return null;
        try
        {
            using var process = Process.GetProcessById(target.Pid);
            var title = new StringBuilder(1024);
            GetWindowText(target.Handle, title, title.Capacity);
            var description = ForegroundAppInfo.DescribeProcess(target.Pid);
            return new ForegroundApp(target.Handle, target.Pid, process.ProcessName, null,
                description.AppName, title.ToString(), null);
        }
        catch (ArgumentException) { return null; }
        catch (InvalidOperationException) { return null; }
        catch (System.ComponentModel.Win32Exception) { return null; }
    }

    internal static bool IsCurrent(ForegroundApp app)
    {
        if (app == null || Own(app.ProcessId) || !IsWindowVisible(app.WindowHandle) ||
            IsIconic(app.WindowHandle) || Pid(app.WindowHandle) != app.ProcessId) return false;
        nint front = Front();
        if (front == 0) return false;
        if (front == app.WindowHandle) return true;
        // Opening the Island is neutral. A genuine app change updates Last and
        // hides old annotations, including while the Island is opened again.
        if (!Own(Pid(front))) return false;
        var last = Last();
        return last?.Handle == app.WindowHandle && last.Pid == app.ProcessId;
    }

    internal static object Inspect()
    {
        nint front = Front();
        var title = new StringBuilder(256);
        GetWindowText(front, title, title.Capacity);
        var last = Last();
        return new { foreground = front.ToString(), foregroundPid = Pid(front), clientPid = Volatile.Read(ref clientPid),
            enginePid = Environment.ProcessId, title = title.ToString(), lastWindow = last?.Handle.ToString(), lastPid = last?.Pid };
    }

    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint window, uint flags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window, out int pid);
    [DllImport("user32.dll")] private static extern bool IsWindow(nint window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(nint window, StringBuilder text, int length);
}
