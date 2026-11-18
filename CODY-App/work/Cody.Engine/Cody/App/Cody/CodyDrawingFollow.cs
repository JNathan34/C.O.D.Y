using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Platform.Capture;
using HeyClicky.Platform.Win32;
using Windows.Graphics.Imaging;
using Windows.UI.Composition;

namespace HeyClicky.App.Cody;

internal sealed class CodyDrawingFollow : IDisposable
{
    private sealed record CaptureOrigin(ForegroundApp App, Bounds Viewport, byte[] Screenshot,
        Task<ForegroundApp> Page);
    private sealed record Placement(Visual Visual, Vector3 Offset);
    private sealed class Mark
    {
        internal int Id;
        internal RectD Box;
        internal string Role;
        internal Placement[] Units = [];
        internal CodyDrawingAnchor Anchor;
        internal (int X, int Y) Offset;
        internal int Misses;
        internal bool Control;
        internal bool VerifyingControl;
        internal bool Visible = true;
        internal bool Removed;
    }

    private static readonly ConditionalWeakTable<byte[], CaptureOrigin> origins = new();
    private readonly ScreenCaptureService capture;
    private readonly DisplayInfo display;
    private readonly ForegroundApp owner;
    private readonly Bounds origin;
    private readonly bool browser;
    private readonly Dictionary<int, Mark> marks = new();
    private readonly Action<Action> post;
    private readonly CancellationTokenSource cancelled = new();
    private readonly CancellationToken token;
    private readonly int width, height, captureDimension;
    private readonly double imageWidth, imageHeight;
    private byte[] baseline;
    private string pageUrl, currentUrl, currentUrlTitle;
    private long nextFrame, nextAddress, fastUntil;
    private int captureRevision;
    private bool sampling, readingAddress, revalidate;

    internal CodyDrawingFollow(ScreenCaptureService capture, DisplayInfo display, byte[] screenshot,
        Vector2 imageSize, Action<Action> post)
    {
        this.capture = capture;
        this.display = display;
        this.post = post;
        token = cancelled.Token;
        if (screenshot != null && origins.TryGetValue(screenshot, out var captured))
        {
            owner = captured.App;
            origin = captured.Viewport;
            screenshot = captured.Screenshot;
        }
        else
        {
            captured = null;
            owner = ForegroundAppInfo.CaptureUserApp();
            if (owner == null || owner.ProcessId == Environment.ProcessId || !TryClientBounds(owner.WindowHandle, out origin))
                return;
        }
        browser = ForegroundAppInfo.IsBrowserProcess(owner.ProcessName, out _);
        imageWidth = imageSize.X;
        imageHeight = imageSize.Y;
        double longest = Math.Max(imageWidth, imageHeight);
        captureDimension = (int)longest;
        double factor = Math.Min(1.0, 1024 / Math.Max(1, longest));
        width = (int)Math.Round(imageWidth * factor);
        height = (int)Math.Round(imageHeight * factor);
        if (Available && screenshot?.Length > 0) _ = Initialize(screenshot, captured?.Page);
    }

    internal static Action<ScreenCaptureFrame, byte[]> RememberCapture()
    {
        var foreground = ForegroundAppInfo.CaptureUserApp();
        if (foreground == null || foreground.ProcessId == Environment.ProcessId ||
            !TryClientBounds(foreground.WindowHandle, out var bounds)) return null;
        var page = ForegroundAppInfo.IsBrowserProcess(foreground.ProcessName, out _)
            ? ReadPage(foreground, CancellationToken.None) : null;
        return (frame, original) => origins.GetValue(frame.Jpeg, _ => new CaptureOrigin(foreground, bounds, original, page));
    }

    internal bool Available => owner != null && width >= 20 && height >= 20 && IntersectsDisplay(origin);
    internal bool OwnerForeground => Available && IsOwnerForeground();
    internal bool Hidden => marks.Count > 0 && marks.Values.All(mark => !mark.Visible || mark.Removed);
    internal bool Moved => marks.Values.Any(mark => mark.Offset != default);
    internal bool HasUnconfirmedMarks => marks.Values.Any(mark => !mark.Visible);
    internal Vector2 Offset => marks.Values.FirstOrDefault(mark => mark.Visible) is { } mark
        ? new Vector2((float)(mark.Offset.X * display.BoundsPx.Width / width / display.Scale),
            (float)(mark.Offset.Y * display.BoundsPx.Height / height / display.Scale)) : Vector2.Zero;

    internal bool CanContinue(ScreenCaptureFrame frame)
    {
        if (!Available) return true;
        bool sameWindow = frame.Jpeg != null && origins.TryGetValue(frame.Jpeg, out var source)
            ? source.App.WindowHandle == owner.WindowHandle : IsOwnerForeground();
        return sameWindow && IsPageCurrent() && !HasUnconfirmedMarks;
    }

    internal object Inspect() => new { ownerForeground = OwnerForeground, pageCurrent = Available && IsPageCurrent(),
        owner = owner?.WindowHandle.ToString(), foreground = GetAncestor(GetForegroundWindow(), 3).ToString(),
        sampling, hasSampled = marks.Values.Any(mark => mark.Anchor != null), viewport = owner != null && TryClientBounds(owner.WindowHandle, out var view)
            ? new { view.Left, view.Top, view.Right, view.Bottom } : null,
        marks = marks.Values.Select(mark => new { id = mark.Id, role = mark.Role, control = mark.Control,
            visible = mark.Visible, removed = mark.Removed, hasFeatures = mark.Anchor?.HasFeatures,
            x = mark.Offset.X, y = mark.Offset.Y, box = ToScreen(mark) }).ToArray() };

    internal void Sync(IReadOnlyList<(int Id, string Role, RectD Box, Visual[] Units)> visible,
        bool streaming = false)
    {
        // Incremental drawing feeds can temporarily omit already painted marks.
        // Keep those visuals alive until a completed frame confirms their removal;
        // otherwise their visibility and entrance animations repeatedly restart.
        if (!streaming)
            foreach (int id in marks.Keys.Except(visible.Select(mark => mark.Id)).ToArray())
                marks.Remove(id);
        foreach (var item in visible)
        {
            if (!marks.TryGetValue(item.Id, out var mark))
            {
                mark = new Mark { Id = item.Id, Box = item.Box, Role = item.Role,
                    Visible = IsOwnerForeground() && IsPageCurrent() && !revalidate };
                marks[item.Id] = mark;
            }
            var old = mark.Units;
            mark.Units = item.Units.Select(unit => old.FirstOrDefault(p => p.Visual == unit) ??
                new Placement(unit, unit.Offset)).ToArray();
            Paint(mark);
        }
    }

    internal void ScreenChanged(string reason)
    {
        if (!Available) return;
        if (reason != "click") revalidate = true;
        nextFrame = 0;
        if (reason != "scroll") captureRevision++;
        fastUntil = Environment.TickCount64 + 900;
        if (reason is "app switch" or "space change" || !IsOwnerForeground() || !IsPageCurrent()) Hide();
    }

    internal int? Press(PointD point)
    {
        if (!OwnerForeground || !IsPageCurrent() ||
            WindowAt(point) != owner.WindowHandle)
            return null;

        double proximity = 12 * Math.Max(1, display.Scale);
        var hit = marks.Values.Where(mark => mark.Control && mark.Visible && !mark.Removed)
            .Select(mark =>
            {
                var box = ToScreen(mark);
                return (Mark: mark, Distance: CodyDrawingControlState.HitDistance(point.X, point.Y,
                    box.X, box.Y, box.Width, box.Height));
            })
            .Where(candidate => candidate.Distance <= proximity * proximity)
            .OrderBy(candidate => candidate.Distance)
            .ThenBy(candidate => candidate.Mark.Box.Width * candidate.Mark.Box.Height)
            .ThenByDescending(candidate => candidate.Mark.Id)
            .FirstOrDefault().Mark;
        if (hit == null) return null;
        hit.Removed = true;
        Paint(hit);
        return hit.Id;
    }

    internal void Tick()
    {
        if (!Available || token.IsCancellationRequested || marks.Count == 0) return;
        if (!IsOwnerForeground() || !TryClientBounds(owner.WindowHandle, out var viewport) || !IntersectsDisplay(viewport))
        {
            Hide();
            return;
        }
        long now = Environment.TickCount64;
        if (browser && !readingAddress && now >= nextAddress) _ = RefreshAddress();
        if (!IsPageCurrent())
        {
            Hide();
            return;
        }

        var windowOffset = ((int)Math.Round((viewport.Left - origin.Left) * width / display.BoundsPx.Width),
            (int)Math.Round((viewport.Top - origin.Top) * height / display.BoundsPx.Height));
        foreach (var mark in marks.Values)
        {
            if (mark.Anchor == null && baseline != null)
                mark.Anchor = new CodyDrawingAnchor(baseline, width, height,
                    mark.Box.X * width / imageWidth, mark.Box.Y * height / imageHeight,
                    mark.Box.Width * width / imageWidth, mark.Box.Height * height / imageHeight);
            if (!mark.VerifyingControl && mark.Visible && !mark.Removed && mark.Role == "ring")
            {
                mark.VerifyingControl = true;
                _ = VerifyControl(mark, ToScreen(mark));
            }
            if (mark.Anchor?.HasFeatures != true && !browser)
            {
                mark.Visible = true;
                mark.Offset = windowOffset;
                Paint(mark);
            }
            else if (mark.Anchor is { HasFeatures: false } && revalidate)
            {
                mark.Visible = false;
                Paint(mark);
            }
        }

        if (sampling || now < nextFrame || baseline == null) return;
        var candidates = marks.Values.Where(mark => !mark.Removed && mark.Anchor?.HasFeatures == true)
            .Select(mark => (mark, mark.Anchor, mark.Offset)).ToArray();
        if (candidates.Length == 0) return;
        sampling = true;
        nextFrame = now + (now < fastUntil ? 75 : 250);
        _ = Locate(viewport, windowOffset, candidates, captureRevision);
    }

    private async Task Initialize(byte[] screenshot, Task<ForegroundApp> page)
    {
        try
        {
            byte[] pixels = await ReadLuminance(screenshot).ConfigureAwait(false);
            post(() => { if (!token.IsCancellationRequested) baseline = pixels; });
            var originalPage = page == null ? null : await page.ConfigureAwait(false);
            post(() =>
            {
                if (token.IsCancellationRequested || originalPage?.BrowserUrl == null) return;
                pageUrl = originalPage.BrowserUrl;
                if (currentUrl == null && IsOwnerForeground() && WindowTitle() == owner.WindowTitle)
                {
                    currentUrl = pageUrl;
                    currentUrlTitle = owner.WindowTitle;
                }
            });
        }
        catch (Exception ex) { Log.Warn("Drawing", "Could not read the drawing's screen anchor: " + ex.Message); }
    }

    private async Task VerifyControl(Mark mark, RectD box)
    {
        bool control = false;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
            timeout.CancelAfter(TimeSpan.FromMilliseconds(600));
            control = await UIAutomationHelpers.ControlFrameNearAsync(box, display.BoundsPx, display.Scale, timeout.Token)
                .WaitAsync(timeout.Token).ConfigureAwait(false) != null;
            // Quiz labels often extend much farther than the radio button.
            foreach (double fraction in new[] { .04, .10, .90, .96 })
            {
                if (control || box.Width < 35 * display.Scale) break;
                var element = await UIAutomationHelpers.ElementAtPointAsync(
                    new PointD(box.X + box.Width * fraction, box.Y + box.Height / 2), timeout.Token)
                    .WaitAsync(timeout.Token).ConfigureAwait(false);
                if (element == null || element.ProcessId != owner.ProcessId ||
                    !CodyDrawingControlState.IsPressable(element.ControlType, element.IsInvokable)) continue;
                RectD target = element.BoundsPx;
                control = box.Contains(new PointD(target.X + target.Width / 2, target.Y + target.Height / 2))
                    && target.Width <= box.Width * 1.3 && target.Height <= box.Height * 1.8;
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Log.Warn("Drawing", "Could not verify the highlighted control: " + ex.Message); }
        post(() =>
        {
            if (!token.IsCancellationRequested && marks.TryGetValue(mark.Id, out var current) &&
                current == mark && OwnerForeground && IsPageCurrent() && ToScreen(mark).Equals(box))
                mark.Control = control;
            else mark.VerifyingControl = false;
        });
    }

    private async Task Locate(Bounds viewport, (int X, int Y) windowOffset,
        (Mark Mark, CodyDrawingAnchor Anchor, (int X, int Y) Offset)[] candidates, int revision)
    {
        var area = display.BoundsPx;
        double sx = width / area.Width, sy = height / area.Height;
        (Mark Mark, (int X, int Y)? Match)[] results = null;
        try
        {
            var frames = await capture.CaptureAllAsync(captureDimension, ct: token).ConfigureAwait(false);
            var frame = frames.FirstOrDefault(f => f.Display.BoundsPx == area);
            if (frame != null)
            {
                var pixels = await ReadLuminance(frame.Jpeg).ConfigureAwait(false);
                int left = (int)Math.Floor((viewport.Left - area.X) * sx);
                int top = (int)Math.Floor((viewport.Top - area.Y) * sy);
                int right = (int)Math.Ceiling((viewport.Right - area.X) * sx);
                int bottom = (int)Math.Ceiling((viewport.Bottom - area.Y) * sy);
                results = candidates.Select(item => (item.Mark,
                    item.Anchor.Locate(pixels, left, top, right, bottom, item.Offset, windowOffset))).ToArray();
                var matches = results.Where(item => item.Match.HasValue).Select(item => item.Match.Value).ToArray();
                var shared = matches.Where(point => matches.Count(other => Nearby(other, point)) >= 2)
                    .Select(point => ((int X, int Y)?)point).FirstOrDefault();
                for (int i = 0; i < results.Length; i++)
                {
                    if (results[i].Match.HasValue) continue;
                    var item = candidates[i];
                    var expected = shared ?? (matches.Any(other => Nearby(other, item.Offset))
                        ? item.Offset : ((int X, int Y)?)null);
                    if (expected is { } shift)
                        results[i].Match = item.Anchor.Locate(pixels, left, top, right, bottom, item.Offset,
                            windowOffset, shift);
                }
            }
        }
        catch (OperationCanceledException) { return; }
        catch (Exception ex) { Log.Warn("Drawing", "Could not locate the drawing's screen anchor: " + ex.Message); }
        post(() =>
        {
            if (token.IsCancellationRequested) return;
            sampling = false;
            if (revision != captureRevision || !IsOwnerForeground() || !IsPageCurrent() ||
                !TryClientBounds(owner.WindowHandle, out var current) ||
                !current.Equals(viewport)) return;
            foreach (var result in results ?? candidates.Select(item => (item.Mark, ((int, int)?)null)).ToArray())
            {
                var mark = result.Mark;
                if (!marks.TryGetValue(mark.Id, out var tracked) || tracked != mark || mark.Removed) continue;
                if (result.Match is { } position)
                {
                    // Ignore single-pixel matching noise without smoothing away actual scroll motion.
                    if (Math.Abs(mark.Offset.X - position.X) > 1 || Math.Abs(mark.Offset.Y - position.Y) > 1)
                        mark.Offset = position;
                    mark.Misses = 0;
                    var box = ToScreen(mark);
                    mark.Visible = box.Right > viewport.Left && box.X < viewport.Right &&
                        box.Bottom > viewport.Top && box.Y < viewport.Bottom;
                }
                else if (++mark.Misses >= 2) mark.Visible = false;
                Paint(mark);
            }
        });
    }

    private static bool Nearby((int X, int Y) a, (int X, int Y) b)
        => Math.Abs(a.X - b.X) <= 2 && Math.Abs(a.Y - b.Y) <= 2;

    private async Task<byte[]> ReadLuminance(byte[] jpeg)
    {
        using var stream = new MemoryStream(jpeg, writable: false).AsRandomAccessStream();
        var decoder = await BitmapDecoder.CreateAsync(stream);
        var transform = new BitmapTransform
        {
            ScaledWidth = (uint)width, ScaledHeight = (uint)height,
            InterpolationMode = BitmapInterpolationMode.Fant
        };
        var data = await decoder.GetPixelDataAsync(BitmapPixelFormat.Rgba8, BitmapAlphaMode.Ignore,
            transform, ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage);
        byte[] rgba = data.DetachPixelData(), grayscale = new byte[width * height];
        for (int i = 0, p = 0; i < grayscale.Length; i++, p += 4)
            grayscale[i] = (byte)((77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2]) >> 8);
        return grayscale;
    }

    private static async Task<ForegroundApp> ReadPage(ForegroundApp owner, CancellationToken token)
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
            timeout.CancelAfter(TimeSpan.FromMilliseconds(850));
            var page = await ForegroundAppInfo.CaptureUserAppAsync(includeBrowserUrl: true, ct: timeout.Token)
                .WaitAsync(timeout.Token).ConfigureAwait(false);
            return page?.WindowHandle == owner.WindowHandle ? page : null;
        }
        catch (OperationCanceledException) { return null; }
        catch (Exception ex) { Log.Warn("Drawing", "Could not read the drawing's page address: " + ex.Message); return null; }
    }

    private async Task RefreshAddress()
    {
        readingAddress = true;
        nextAddress = Environment.TickCount64 + 300;
        string title = WindowTitle();
        var page = await ReadPage(owner, token).ConfigureAwait(false);
        post(() =>
        {
            if (token.IsCancellationRequested) return;
            readingAddress = false;
            if (page?.WindowTitle != title || title != WindowTitle() || string.IsNullOrWhiteSpace(page.BrowserUrl)) return;
            currentUrl = page.BrowserUrl;
            currentUrlTitle = title;
            if (!IsPageCurrent())
            {
                captureRevision++;
                Hide();
            }
        });
    }

    private bool IsPageCurrent()
    {
        string title = WindowTitle();
        if (!browser || pageUrl == null) return title == owner.WindowTitle;
        return currentUrlTitle == title && currentUrl == pageUrl;
    }

    private string WindowTitle()
    {
        var title = new StringBuilder(1024);
        GetWindowText(owner.WindowHandle, title, title.Capacity);
        return title.ToString();
    }

    private bool IntersectsDisplay(Bounds rect) => rect.Right > display.BoundsPx.X && rect.Bottom > display.BoundsPx.Y &&
        rect.Left < display.BoundsPx.Right && rect.Top < display.BoundsPx.Bottom && rect.Right > rect.Left && rect.Bottom > rect.Top;

    private bool IsOwnerForeground()
    {
        nint front = GetAncestor(GetForegroundWindow(), 3);
        return front == owner.WindowHandle && !IsIconic(front);
    }

    private RectD ToScreen(Mark mark)
    {
        var area = display.BoundsPx;
        return new RectD(area.X + area.Width * (mark.Box.X / imageWidth + mark.Offset.X / (double)width),
            area.Y + area.Height * (mark.Box.Y / imageHeight + mark.Offset.Y / (double)height),
            mark.Box.Width * area.Width / imageWidth, mark.Box.Height * area.Height / imageHeight);
    }

    private void Hide()
    {
        foreach (var mark in marks.Values)
        {
            mark.Visible = false;
            Paint(mark);
        }
    }

    private void Paint(Mark mark)
    {
        var translation = new Vector3((float)(mark.Offset.X * imageWidth / width),
            (float)(mark.Offset.Y * imageHeight / height), 0);
        foreach (var unit in mark.Units)
        {
            var offset = unit.Offset + translation;
            bool visible = mark.Visible && !mark.Removed;
            if (unit.Visual.Offset != offset) unit.Visual.Offset = offset;
            if (unit.Visual.IsVisible != visible) unit.Visual.IsVisible = visible;
        }
    }

    public void Dispose()
    {
        cancelled.Cancel();
        cancelled.Dispose();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Bounds { internal int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { internal int X, Y; }

    private static bool TryClientBounds(nint hwnd, out Bounds rect)
    {
        using var dpi = new PhysicalCoordinates();
        var origin = new NativePoint();
        if (!GetClientRect(hwnd, out rect) || !ClientToScreen(hwnd, ref origin)) return false;
        rect.Left += origin.X;
        rect.Right += origin.X;
        rect.Top += origin.Y;
        rect.Bottom += origin.Y;
        return rect.Right > rect.Left && rect.Bottom > rect.Top;
    }

    private static nint WindowAt(PointD point)
    {
        using var dpi = new PhysicalCoordinates();
        return GetAncestor(WindowFromPoint(new NativePoint { X = (int)point.X, Y = (int)point.Y }), 3);
    }

    // CODYEngine is launched through a native host. Its drawing thread can
    // otherwise receive virtualized coordinates while screenshots use pixels.
    private readonly struct PhysicalCoordinates : IDisposable
    {
        private readonly nint previous;
        public PhysicalCoordinates() => previous = SetThreadDpiAwarenessContext(-4);
        public void Dispose()
        {
            if (previous != 0) SetThreadDpiAwarenessContext(previous);
        }
    }

    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern nint SetThreadDpiAwarenessContext(nint context);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint window, uint flags);
    [DllImport("user32.dll")] private static extern nint WindowFromPoint(NativePoint point);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint window);
    [DllImport("user32.dll")] private static extern bool GetClientRect(nint window, out Bounds rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(nint window, ref NativePoint point);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(nint window, StringBuilder text, int maximum);
}
