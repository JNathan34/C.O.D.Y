using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.App.Interop;
using HeyClicky.Platform.Capture;
using HeyClicky.Platform.Win32;

namespace HeyClicky.App.Cody;

internal static class CodyMonitorAccess
{
    internal const string Blocked = "This monitor is blocked in Settings > Permissions > Monitor access.";
    internal sealed record Policy(string mainId = null, string[] allowedIds = null);
    internal sealed record Monitor(DisplayInfo Display, string Id, string Label, bool Identified);
    private static readonly JsonSerializerOptions json = new(JsonSerializerDefaults.Web);
    private static string file;
    private static volatile Policy policy = new();
    internal static bool Restricted => CodyEngineBridge.EngineMode && policy.allowedIds != null;
    internal static bool HasPreference => CodyEngineBridge.EngineMode && (policy.mainId != null || Restricted);

    internal static void Load(string directory)
    {
        file = Path.Combine(directory, "monitor-access.json");
        try { policy = JsonSerializer.Deserialize<Policy>(File.ReadAllText(file), json) ?? new(allowedIds: []); }
        catch (FileNotFoundException) { policy = new(); }
        catch (IOException) { policy = new(allowedIds: []); }
        catch (JsonException) { policy = new(allowedIds: []); }
        catch (UnauthorizedAccessException) { policy = new(allowedIds: []); }
    }

    internal static Monitor[] Monitors() => DisplayEnumerator.GetDisplays().Select(display =>
    {
        var device = new DisplayDevice { Size = Marshal.SizeOf<DisplayDevice>() };
        bool identified = EnumDisplayDevices(display.DeviceName, 0, ref device, 1) && !string.IsNullOrWhiteSpace(device.Id);
        string id = identified ? Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(device.Id.ToUpperInvariant()))) : display.DeviceName;
        string label = identified && !string.IsNullOrWhiteSpace(device.Label) ? device.Label : "Display " + (display.Index + 1);
        return new Monitor(display, id, label, identified);
    }).ToArray();

    private static bool Allows(Monitor monitor, Policy rules) => rules.allowedIds == null ||
        monitor.Identified && rules.allowedIds.Contains(monitor.Id, StringComparer.Ordinal);

    internal static Monitor[] Allowed()
    {
        var rules = policy;
        return Monitors().Where(monitor => Allows(monitor, rules))
            .OrderByDescending(monitor => monitor.Id == rules.mainId).ToArray();
    }

    internal static object Snapshot()
    {
        var rules = policy;
        var monitors = Monitors();
        return new { rules.mainId, rules.allowedIds, displays = monitors.Select(monitor => new {
            id = monitor.Id, label = monitor.Label, identified = monitor.Identified, primary = monitor.Display.IsPrimary,
            x = monitor.Display.BoundsPx.X, y = monitor.Display.BoundsPx.Y,
            width = monitor.Display.BoundsPx.Width, height = monitor.Display.BoundsPx.Height
        }).ToArray() };
    }

    internal static void Configure(JsonElement request)
    {
        var next = request.Deserialize<Policy>(json) ?? throw new ArgumentException("Choose monitor access settings.");
        var monitors = Monitors();
        bool Known(string id, bool requireIdentity) => monitors.Any(monitor => monitor.Id == id && (!requireIdentity || monitor.Identified));
        if (next.mainId != null && !Known(next.mainId, next.allowedIds != null))
            throw new ArgumentException("Choose a connected main monitor.");
        if (next.allowedIds != null && (next.mainId == null || next.allowedIds.Length > 32 ||
            !next.allowedIds.Contains(next.mainId) || next.allowedIds.Any(id => !Known(id, true))))
            throw new ArgumentException("Choose which connected monitors Cody can access, including the main monitor.");
        File.WriteAllText(file + ".tmp", JsonSerializer.Serialize(next, json));
        File.Move(file + ".tmp", file, true);
        policy = next;
    }

    internal static bool AllowsPoint(PointD point) => !Restricted || Allowed().Any(monitor =>
        point.X >= monitor.Display.BoundsPx.X && point.X < monitor.Display.BoundsPx.Right &&
        point.Y >= monitor.Display.BoundsPx.Y && point.Y < monitor.Display.BoundsPx.Bottom);

    internal static bool AllowsWindow(nint window)
    {
        if (!Restricted) return true;
        if (window == 0 || DwmGetWindowAttribute(window, 9, out var bounds, Marshal.SizeOf<Native.RECT>()) != 0) return false;
        // A window spanning protected screens must not be read through accessibility.
        var monitors = Monitors();
        var rules = policy;
        bool Intersects(Monitor monitor)
        {
            var area = monitor.Display.BoundsPx;
            return bounds.Left < area.Right && bounds.Right > area.X && bounds.Top < area.Bottom && bounds.Bottom > area.Y;
        }
        var touched = monitors.Where(Intersects).ToArray();
        return touched.Length > 0 && touched.All(monitor => Allows(monitor, rules));
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayDevice
    {
        public int Size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Label;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Id;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Key;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplayDevices(string device, uint index, ref DisplayDevice info, uint flags);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint window, int attribute, out Native.RECT bounds, int size);
}

internal sealed class CodyMonitorCapture(ScreenCaptureService inner) : IScreenCaptureService
{
    public IReadOnlyList<DisplayInfo> GetDisplays() => CodyMonitorAccess.HasPreference
        ? CodyMonitorAccess.Allowed().Select(monitor => monitor.Display).ToArray() : inner.GetDisplays();

    public DisplayInfo GetDisplayUnderCursor() => !CodyMonitorAccess.HasPreference ? inner.GetDisplayUnderCursor()
        : GetDisplays().FirstOrDefault() ?? new DisplayInfo(-1, "", default, default, 1, false);

    public Task<IReadOnlyList<ScreenCaptureFrame>> CaptureAllAsync(int maxDimension = 1280, int jpegQuality = 80, CancellationToken ct = default)
        => !CodyMonitorAccess.HasPreference ? inner.CaptureAllAsync(maxDimension, jpegQuality, ct) : Capture(_ => maxDimension, ct);

    public Task<IReadOnlyList<ScreenCaptureFrame>> CaptureAllAtDisplayPointSizeAsync()
        => !CodyMonitorAccess.HasPreference ? inner.CaptureAllAtDisplayPointSizeAsync() : Capture(ScreenCaptureService.DisplayPointSizeMaxDimension, default);

    public async Task<(byte[] Jpeg, int Width, int Height)> CaptureRegionAsync(DisplayInfo display, RectD region, int size = 1600, CancellationToken ct = default)
    {
        if (!CodyMonitorAccess.Restricted) return await inner.CaptureRegionAsync(display, region, size, ct);
        var monitor = CodyMonitorAccess.Allowed().FirstOrDefault(item => item.Display == display);
        if (monitor == null) throw new InvalidOperationException(CodyMonitorAccess.Blocked);
        var result = await inner.CaptureRegionAsync(display, region, size, ct);
        if (!CodyMonitorAccess.Allowed().Any(item => item == monitor)) throw new InvalidOperationException(CodyMonitorAccess.Blocked);
        return result;
    }

    private async Task<IReadOnlyList<ScreenCaptureFrame>> Capture(Func<DisplayInfo, int> size, CancellationToken ct)
    {
        var frames = new List<ScreenCaptureFrame>();
        foreach (var display in GetDisplays())
        {
            ct.ThrowIfCancellationRequested();
            var bounds = display.BoundsPx;
            var captured = await CaptureRegionAsync(display, new RectD(0, 0, bounds.Width, bounds.Height), size(display), ct);
            frames.Add(new ScreenCaptureFrame(display, captured.Jpeg, captured.Width, captured.Height, false, default));
        }
        return frames;
    }
}
