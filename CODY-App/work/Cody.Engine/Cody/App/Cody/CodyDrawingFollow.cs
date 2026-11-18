using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Platform.Capture;
using HeyClicky.Platform.Win32;
using Windows.UI.Composition;

namespace HeyClicky.App.Cody;

internal sealed class CodyDrawingFollow : IDisposable
{
    private sealed record CaptureOrigin(ForegroundApp App, Bounds Viewport, Task<CodyDrawingTarget.Document> Document);
    private sealed record Placement(Visual Visual, Vector3 Offset, Vector3 Scale);
    private sealed class Mark
    {
        internal int Id;
        internal RectD Box;
        internal string Role;
        internal Placement[] Units = [];
        internal CodyDrawingTarget.Anchor Anchor;
        internal bool BindingAttempted;
        internal Vector2 Offset;
        internal Vector2 Scale = Vector2.One;
        internal bool Control;
        internal bool VerifyingControl;
        internal bool Visible;
        internal bool Removed;
    }

    private static readonly ConditionalWeakTable<byte[], CaptureOrigin> origins = new();
    private readonly DisplayInfo display;
    private readonly ForegroundApp owner;
    private readonly Bounds origin;
    private readonly bool contentTracking;
    private readonly Dictionary<int, Mark> marks = new();
    private readonly Action<Action> post;
    private readonly Action<RectD> resizeSurface;
    private readonly Action<int[]> retireMarks;
    private readonly CancellationTokenSource cancelled = new();
    private readonly CancellationToken token;
    private readonly double imageWidth, imageHeight;
    private CodyDrawingTarget.Document document;
    private RectD surface;
    private long nextRead, lastRead;
    private bool reading, scheduled, contextChanged, pageCurrent;
    private string confirmedTitle;

    internal CodyDrawingFollow(DisplayInfo display, byte[] screenshot, Vector2 imageSize, Action<Action> post,
        Action<RectD> resizeSurface, Action<int[]> retireMarks)
    {
        this.display = display;
        this.post = post;
        this.resizeSurface = resizeSurface;
        this.retireMarks = retireMarks;
        surface = display.BoundsPx;
        token = cancelled.Token;
        imageWidth = imageSize.X;
        imageHeight = imageSize.Y;
        if (screenshot != null && origins.TryGetValue(screenshot, out var captured))
        {
            owner = captured.App;
            origin = captured.Viewport;
            contentTracking = TracksDocument(owner);
            if (captured.Document != null) _ = UseDocument(captured.Document);
        }
        else
        {
            owner = ForegroundAppInfo.CaptureUserApp();
            if (owner == null || owner.ProcessId == Environment.ProcessId || !TryClientBounds(owner.WindowHandle, out origin))
                return;
            contentTracking = TracksDocument(owner);
        }
    }

    internal static Action<ScreenCaptureFrame, byte[]> RememberCapture()
    {
        var app = ForegroundAppInfo.CaptureUserApp();
        if (app == null || app.ProcessId == Environment.ProcessId || !TryClientBounds(app.WindowHandle, out var bounds))
            return null;
        var document = TracksDocument(app)
            ? CodyDrawingTarget.Capture(app.WindowHandle, bounds.Rect, IsBrowser(app), () => OwnerIsForeground(app))
            : null;
        return (frame, _) => origins.GetValue(frame.Jpeg, _ => new CaptureOrigin(app, bounds, document));
    }

    private static bool IsBrowser(ForegroundApp app) => ForegroundAppInfo.IsBrowserProcess(app.ProcessName, out _);
    private static bool TracksDocument(ForegroundApp app) =>
        IsBrowser(app) || app.ProcessName.Equals("winword", StringComparison.OrdinalIgnoreCase) ||
        app.ProcessName.Equals("electron", StringComparison.OrdinalIgnoreCase);

    private async Task UseDocument(Task<CodyDrawingTarget.Document> pending)
    {
        var captured = await pending.ConfigureAwait(false);
        post(() =>
        {
            if (!token.IsCancellationRequested) document = captured;
        });
    }

    internal bool Available => owner != null && imageWidth > 0 && imageHeight > 0 && IntersectsDisplay(origin);
    internal bool OwnerForeground => Available && IsOwnerForeground();
    internal bool Hidden => marks.Count > 0 && marks.Values.All(mark => !mark.Visible || mark.Removed);
    internal bool HasHiddenDrawing => marks.Values.Any(mark => !mark.Visible && !mark.Removed &&
        (mark.Anchor != null || !contentTracking));
    internal bool Moved => marks.Values.Any(mark => mark.Offset != Vector2.Zero || mark.Scale != Vector2.One);
    internal Vector2 Offset => marks.Values.FirstOrDefault(mark => mark.Visible)?.Offset / (float)display.Scale ?? Vector2.Zero;

    internal bool CanContinue(ScreenCaptureFrame frame)
    {
        if (!Available) return true;
        bool sameWindow = frame.Jpeg != null && origins.TryGetValue(frame.Jpeg, out var source)
            ? source.App.WindowHandle == owner.WindowHandle : IsOwnerForeground();
        return sameWindow && IsPageCurrent() && !marks.Values.Any(mark => !mark.Visible);
    }

    internal object Inspect() => new { ownerForeground = OwnerForeground, pageCurrent = Available && IsPageCurrent(),
        owner = owner?.WindowHandle.ToString(), foreground = GetAncestor(GetForegroundWindow(), 3).ToString(),
        sampling = reading, hasSampled = marks.Values.Any(mark => mark.Anchor != null),
        viewport = owner != null && TryClientBounds(owner.WindowHandle, out var view) ? view.Rect : (RectD?)null,
        tracking = contentTracking ? "document" : "window", hasBrowserTab = document?.Tab != null,
        marks = marks.Values.Select(mark => new { id = mark.Id, role = mark.Role, control = mark.Control,
            visible = mark.Visible, removed = mark.Removed, anchored = mark.Anchor != null,
            x = mark.Offset.X, y = mark.Offset.Y, box = ToScreen(mark) }).ToArray() };

    internal void Sync(IReadOnlyList<(int Id, string Role, RectD Box, Visual[] Units)> visible,
        bool streaming = false)
    {
        // Incremental drawing feeds can omit existing render units briefly.
        if (!streaming)
            foreach (int id in marks.Keys.Except(visible.Select(mark => mark.Id)).ToArray()) marks.Remove(id);
        foreach (var item in visible)
        {
            if (!marks.TryGetValue(item.Id, out var mark))
            {
                mark = new Mark { Id = item.Id, Box = item.Box, Role = item.Role,
                    Visible = !contentTracking && IsOwnerForeground() && IsPageCurrent() };
                marks[item.Id] = mark;
            }
            var old = mark.Units;
            mark.Units = item.Units.Select(unit => old.FirstOrDefault(p => p.Visual == unit) ??
                new Placement(unit, unit.Offset, unit.Scale)).ToArray();
            Paint(mark);
        }
    }

    internal void ScreenChanged(string reason)
    {
        if (!Available) return;
        if (reason is "scroll" or "window moved" or "app switch" or "space change") contextChanged = true;
        nextRead = 0;
        if (!IsOwnerForeground() || !IsPageCurrent()) Hide();
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
        if (!IsOwnerForeground() || !TryClientBounds(owner.WindowHandle, out var viewport))
        {
            Hide();
            return;
        }
        ResizeSurface(viewport);
        if (!contentTracking)
        {
            foreach (var mark in marks.Values)
            {
                mark.Offset = new Vector2(viewport.Left - origin.Left, viewport.Top - origin.Top);
                mark.Visible = IsPageCurrent() && IsOnDisplay(ToScreen(mark), viewport);
                VerifyIfNeeded(mark);
                Paint(mark);
            }
            return;
        }
        if (document == null) return;
        if (!IsPageCurrent()) Hide();

        long now = Environment.TickCount64;
        if (reading || now < nextRead) return;
        bool sameGeometry = viewport.Equals(origin);
        var queries = marks.Values.Where(mark => !mark.Removed &&
            (mark.Anchor != null || !mark.BindingAttempted && sameGeometry && !contextChanged))
            .Select(mark => new CodyDrawingTarget.Query(mark.Id, OriginalBox(mark), mark.Anchor,
                sameGeometry && !contextChanged)).ToArray();
        if (queries.Length == 0) return;
        reading = true;
        nextRead = now + 33;
        _ = ReadTargets(viewport, WindowTitle(), queries);
    }

    private async Task ReadTargets(Bounds viewport, string title, CodyDrawingTarget.Query[] queries)
    {
        var frames = await CodyDrawingTarget.Read(owner.WindowHandle, document, viewport.Rect, queries,
            () => !token.IsCancellationRequested && IsOwnerForeground()).ConfigureAwait(false);
        post(() =>
        {
            if (token.IsCancellationRequested) return;
            reading = false;
            if (!IsOwnerForeground() || title != WindowTitle() || !TryClientBounds(owner.WindowHandle, out var current) ||
                !current.Equals(viewport))
            {
                Schedule();
                return;
            }

            if (frames?.TabClosed == true)
            {
                Hide();
                document = null;
                pageCurrent = false;
                foreach (var mark in marks.Values) mark.Removed = true;
                retireMarks(marks.Keys.ToArray());
                return;
            }
            if (frames != null)
            {
                lastRead = Environment.TickCount64;
                pageCurrent = frames.Targets.Length > 0;
                if (!pageCurrent) nextRead = lastRead + 150;
                confirmedTitle = title;
                if (!pageCurrent) Hide();
                foreach (var frame in frames.Targets)
                {
                    if (!marks.TryGetValue(frame.Id, out var mark) || mark.Removed) continue;
                    if (mark.Anchor == null && !contextChanged)
                    {
                        mark.BindingAttempted = true;
                        mark.Anchor = frame.Anchor;
                        if (mark.Role == "ring" && mark.Anchor?.Control == true)
                        {
                            mark.Control = true;
                            mark.VerifyingControl = true;
                        }
                    }
                    mark.Visible = false;
                    if (mark.Anchor != null && frame.Bounds is { } bounds)
                    {
                        var basis = mark.Anchor.Original;
                        mark.Scale = new Vector2((float)(bounds.Width / basis.Width), (float)(bounds.Height / basis.Height));
                        var original = OriginalBox(mark);
                        var projected = CodyDrawingGeometry.Project(original, basis, bounds);
                        mark.Offset = new Vector2((float)(projected.X - original.X), (float)(projected.Y - original.Y));
                        mark.Visible = IsOnDisplay(ToScreen(mark), viewport);
                        VerifyIfNeeded(mark);
                    }
                    Paint(mark);
                }
            }
            else if (Environment.TickCount64 - lastRead > 500) Hide();
            Schedule();
        });
    }

    private void Schedule()
    {
        if (scheduled || token.IsCancellationRequested) return;
        scheduled = true;
        _ = ScheduleTick();
    }

    private async Task ScheduleTick()
    {
        try
        {
            await Task.Delay((int)Math.Max(10, nextRead - Environment.TickCount64), token)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) { return; }
        post(() =>
        {
            scheduled = false;
            Tick();
        });
    }

    private bool IsPageCurrent() => contentTracking
        ? pageCurrent && confirmedTitle == WindowTitle()
        : owner.WindowTitle == WindowTitle();

    private void VerifyIfNeeded(Mark mark)
    {
        if (mark.VerifyingControl || !mark.Visible || mark.Removed || mark.Role != "ring") return;
        mark.VerifyingControl = true;
        _ = VerifyControl(mark, ToScreen(mark));
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



    private string WindowTitle()
    {
        var title = new StringBuilder(1024);
        GetWindowText(owner.WindowHandle, title, title.Capacity);
        return title.ToString();
    }

    private bool IntersectsDisplay(Bounds rect) => rect.Right > display.BoundsPx.X && rect.Bottom > display.BoundsPx.Y &&
        rect.Left < display.BoundsPx.Right && rect.Top < display.BoundsPx.Bottom && rect.Right > rect.Left && rect.Bottom > rect.Top;

    private bool IsOwnerForeground() => OwnerIsForeground(owner);



    private static bool OwnerIsForeground(ForegroundApp app)
    {
        nint front = GetAncestor(GetForegroundWindow(), 3);
        return front == app.WindowHandle && !IsIconic(front);
    }

    private RectD OriginalBox(Mark mark)
    {
        var area = display.BoundsPx;
        return new RectD(area.X + area.Width * mark.Box.X / imageWidth, area.Y + area.Height * mark.Box.Y / imageHeight,
            mark.Box.Width * area.Width / imageWidth, mark.Box.Height * area.Height / imageHeight);
    }

    private RectD ToScreen(Mark mark)
    {
        var box = OriginalBox(mark);
        return new RectD(box.X + mark.Offset.X, box.Y + mark.Offset.Y,
            box.Width * mark.Scale.X, box.Height * mark.Scale.Y);
    }

    private bool IsOnDisplay(RectD box, Bounds viewport) =>
        CodyDrawingGeometry.Visible(box, viewport.Rect, surface);

    private void ResizeSurface(Bounds viewport)
    {
        if (resizeSurface == null) return;
        var requested = display.BoundsPx;
        if (CodyDrawingGeometry.Intersection(viewport.Rect, requested) != viewport.Rect)
        {
            using var dpi = new PhysicalCoordinates();
            foreach (var monitor in DisplayEnumerator.GetDisplays())
                if (CodyDrawingGeometry.Intersection(viewport.Rect, monitor.BoundsPx) is { } visible)
                    requested = CodyDrawingGeometry.Union(requested, visible);
        }
        if (surface == requested) return;
        resizeSurface(requested);
        surface = requested;
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
        var area = display.BoundsPx;
        var scale = new Vector3(mark.Scale, 1);
        var translation = new Vector3(
            (float)(mark.Box.X * (1 - scale.X) + mark.Offset.X * imageWidth / area.Width),
            (float)(mark.Box.Y * (1 - scale.Y) + mark.Offset.Y * imageHeight / area.Height), 0);
        foreach (var unit in mark.Units)
        {
            var center = unit.Visual.CenterPoint;
            var offset = (unit.Offset + center) * scale - center + translation;
            if (unit.Visual.Offset != offset) unit.Visual.Offset = offset;
            if (scale != Vector3.One || mark.Anchor != null)
            {
                var resized = unit.Scale * scale;
                if (unit.Visual.Scale != resized) unit.Visual.Scale = resized;
            }
            bool visible = mark.Visible && !mark.Removed;
            if (unit.Visual.IsVisible != visible) unit.Visual.IsVisible = visible;
        }
    }

    public void Dispose()
    {
        cancelled.Cancel();
        cancelled.Dispose();
    }


    [StructLayout(LayoutKind.Sequential)]
    private struct Bounds { internal int Left, Top, Right, Bottom; internal RectD Rect => new(Left, Top, Right-Left, Bottom-Top); }
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
