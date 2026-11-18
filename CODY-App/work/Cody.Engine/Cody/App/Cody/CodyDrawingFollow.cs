using System;
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
    private sealed record CaptureOrigin(ForegroundApp App, Rect Bounds, byte[] Screenshot);
    private static readonly ConditionalWeakTable<byte[], CaptureOrigin> origins = new();
    private readonly ScreenCaptureService capture;
    private readonly DisplayInfo display;
    private readonly ForegroundApp owner;
    private readonly Rect origin;
    private readonly bool browser;
    private readonly Action<Action> post;
    private readonly CancellationTokenSource cancelled = new();
    private readonly CancellationToken token;
    private readonly int width;
    private readonly int height;
    private readonly int captureDimension;
    private byte[] screenshot;
    private CodyDrawingAnchor anchor;
    private CompositionVisualState scene;
    private (int X, int Y) previous;
    private string pageUrl;
    private string currentUrl;
    private string currentUrlTitle;
    private long nextFrame;
    private long nextAddress;
    private bool sampling;
    private bool readingAddress;
    private bool initialized;
    private bool hasSampled;
    private bool needsMatch;
    private bool keepUnmatched;

    internal CodyDrawingFollow(ScreenCaptureService capture, DisplayInfo display, byte[] screenshot,
        Vector2 imageSize, Action<Action> post)
    {
        this.capture = capture;
        this.display = display;
        this.screenshot = screenshot;
        this.post = post;
        token = cancelled.Token;
        if (screenshot != null && origins.TryGetValue(screenshot, out var captured))
        {
            owner = captured.App;
            origin = captured.Bounds;
            this.screenshot = captured.Screenshot;
        }
        else
        {
            owner = ForegroundAppInfo.CaptureUserApp();
            if (owner == null || owner.ProcessId == Environment.ProcessId || !TryClientBounds(owner.WindowHandle, out origin))
                return;
        }
        browser = ForegroundAppInfo.IsBrowserProcess(owner.ProcessName, out _);
        captureDimension = (int)Math.Max(imageSize.X, imageSize.Y);
        double factor = Math.Min(1.0, 1024 / (double)Math.Max(1, Math.Max(imageSize.X, imageSize.Y)));
        width = (int)Math.Round(imageSize.X * factor);
        height = (int)Math.Round(imageSize.Y * factor);
        if (browser && IsOwnerForeground()) ReadAddress();
    }

    internal static Action<ScreenCaptureFrame, byte[]> RememberCapture()
    {
        var foreground = ForegroundAppInfo.CaptureUserApp();
        if (foreground == null || foreground.ProcessId == Environment.ProcessId || !TryClientBounds(foreground.WindowHandle, out var bounds))
            return null;
        return (frame, original) => origins.GetValue(frame.Jpeg, _ => new CaptureOrigin(foreground, bounds, original));
    }

    internal bool Available => IntersectsDisplay(origin);
    internal bool Hidden => scene != null && !scene.Visual.IsVisible;
    internal bool Moved => scene != null && scene.Visual.Offset != scene.Offset;
    internal bool OwnerForeground => Available && IsOwnerForeground();

    internal bool CanContinue(ScreenCaptureFrame frame)
    {
        if (!Available) return true;
        bool sameWindow = frame.Jpeg != null && origins.TryGetValue(frame.Jpeg, out var source)
            ? source.App.WindowHandle == owner.WindowHandle
            : IsOwnerForeground();
        return sameWindow && IsPageCurrent();
    }

    internal object Inspect() => new { ownerForeground = OwnerForeground, pageCurrent = Available && IsPageCurrent(),
        owner = owner?.WindowHandle.ToString(), foreground = GetAncestor(GetForegroundWindow(), 3).ToString(),
        sampling, hasSampled, previous = previous.ToString() };
    internal void ScreenChanged(string reason)
    {
        if (!browser) return;
        if (CodyEngineBridge.EngineMode && reason is ("click" or "app switch" or "space change"))
            keepUnmatched = true;
        if (reason is ("scroll" or "window moved") && IsOwnerForeground() && IsPageCurrent())
        {
            keepUnmatched = false;
            needsMatch = true;
        }
    }

    internal void Tick(Visual visual, (double X, double Y, double Width, double Height) mark, Vector2 imageSize)
    {
        if (!Available || token.IsCancellationRequested || visual == null) return;
        scene ??= new CompositionVisualState(visual, visual.Offset, visual.Clip);
        if (!IsOwnerForeground() || !TryClientBounds(owner.WindowHandle, out var viewport))
        {
            // Preserve the last screen placement while another window has focus.
            if (!CodyEngineBridge.EngineMode) visual.IsVisible = false;
            return;
        }
        if (CodyEngineBridge.EngineMode && !IntersectsDisplay(viewport)) return;
        long now = Environment.TickCount64;
        if (browser && !readingAddress && now >= nextAddress) ReadAddress();
        if (!IsPageCurrent())
        {
            visual.IsVisible = false;
            return;
        }

        int dx = viewport.Left - origin.Left, dy = viewport.Top - origin.Top;
        if (!browser)
        {
            Place(viewport, dx, dy);
            return;
        }

        if (width < 20 || height < 20 || imageSize.X <= 0 || imageSize.Y <= 0) return;
        if (sampling || now < nextFrame) return;
        sampling = true;
        nextFrame = now + (Hidden ? 350 : 200);
        if (!initialized)
        {
            double sx = width / (double)imageSize.X, sy = height / (double)imageSize.Y;
            _ = Initialize(mark.X * sx, mark.Y * sy, mark.Width * sx, mark.Height * sy);
            return;
        }
        if (anchor?.HasFeatures != true)
        {
            sampling = false;
            visual.IsVisible = !needsMatch && dx == 0 && dy == 0;
            return;
        }
        _ = Locate(viewport, dx, dy);
    }

    private async Task Initialize(double x, double y, double w, double h)
    {
        var baseline = screenshot;
        screenshot = null;
        CodyDrawingAnchor result = null;
        try
        {
            if (baseline?.Length > 0)
                result = new CodyDrawingAnchor(await ReadLuminance(baseline).ConfigureAwait(false), width, height, x, y, w, h);
        }
        catch (Exception ex) { Log.Warn("Drawing", "Could not read the drawing's screen anchor: " + ex.Message); }
        post(() =>
        {
            if (token.IsCancellationRequested) return;
            anchor = result;
            initialized = true;
            sampling = false;
        });
    }

    private async Task Locate(Rect viewport, int dx, int dy)
    {
        var area = display.BoundsPx;
        double sx = width / area.Width, sy = height / area.Height;
        var last = previous;
        (int X, int Y)? match = null;
        bool capturedFrame = false;
        try
        {
            var frames = await capture.CaptureAllAsync(captureDimension, ct: token).ConfigureAwait(false);
            var frame = frames.FirstOrDefault(f => f.Display.BoundsPx == area);
            if (frame == null) throw new InvalidOperationException("The drawing's display is no longer available.");
            var pixels = await ReadLuminance(frame.Jpeg).ConfigureAwait(false);
            match = anchor.Locate(pixels, (int)Math.Floor((viewport.Left - area.X) * sx),
                (int)Math.Floor((viewport.Top - area.Y) * sy), (int)Math.Ceiling((viewport.Right - area.X) * sx),
                (int)Math.Ceiling((viewport.Bottom - area.Y) * sy), last,
                ((int)Math.Round(dx * sx), (int)Math.Round(dy * sy)));
            capturedFrame = true;
        }
        catch (OperationCanceledException) { return; }
        catch (Exception ex) { Log.Warn("Drawing", "Could not locate the drawing's screen anchor: " + ex.Message); }
        post(() =>
        {
            if (token.IsCancellationRequested) return;
            sampling = false;
            if (scene == null || !IsOwnerForeground() || !IsPageCurrent() || !TryClientBounds(owner.WindowHandle, out var current) ||
                !current.Equals(viewport)) return;
            if (match is { } position)
            {
                hasSampled = true;
                needsMatch = false;
                if (Math.Abs(position.X - previous.X) > 1 || Math.Abs(position.Y - previous.Y) > 1)
                    keepUnmatched = false;
                previous = position;
                Place(viewport, position.X / sx, position.Y / sy);
            }
            else if (needsMatch || (!keepUnmatched && (capturedFrame || hasSampled || dx != 0 || dy != 0)))
            {
                scene.Visual.IsVisible = false;
            }
        });
    }

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

    private async void ReadAddress()
    {
        readingAddress = true;
        nextAddress = Environment.TickCount64 + 750;
        var text = new StringBuilder(1024);
        GetWindowText(owner.WindowHandle, text, text.Capacity);
        string startedOn = text.ToString();
        ForegroundApp page = null;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
            timeout.CancelAfter(TimeSpan.FromMilliseconds(900));
            page = await ForegroundAppInfo.CaptureUserAppAsync(includeBrowserUrl: true, ct: timeout.Token)
                .WaitAsync(timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Log.Warn("Drawing", "Could not read the drawing's page address: " + ex.Message); }
        post(() =>
        {
            if (token.IsCancellationRequested) return;
            readingAddress = false;
            if (page?.WindowHandle != owner.WindowHandle || page.WindowTitle != startedOn || string.IsNullOrWhiteSpace(page.BrowserUrl))
                return;
            currentUrl = page.BrowserUrl.Split('#', 2)[0];
            currentUrlTitle = startedOn;
            if (pageUrl == null && startedOn == owner.WindowTitle) pageUrl = currentUrl;
        });
    }

    private bool IsPageCurrent()
    {
        if (!browser) return true;
        var title = new StringBuilder(1024);
        GetWindowText(owner.WindowHandle, title, title.Capacity);
        string visibleTitle = title.ToString();
        if (CodyEngineBridge.EngineMode && pageUrl != null)
            return currentUrl == pageUrl;
        return pageUrl != null && currentUrlTitle == visibleTitle
            ? currentUrl == pageUrl
            : visibleTitle == owner.WindowTitle;
    }

    private bool IntersectsDisplay(Rect rect) => rect.Right > display.BoundsPx.X && rect.Bottom > display.BoundsPx.Y &&
        rect.Left < display.BoundsPx.Right && rect.Top < display.BoundsPx.Bottom && rect.Right > rect.Left && rect.Bottom > rect.Top;

    private bool IsOwnerForeground()
    {
        nint front = GetAncestor(GetForegroundWindow(), 3);
        return front == owner.WindowHandle && !IsIconic(front);
    }

    private void Place(Rect viewport, double dx, double dy)
    {
        var visual = scene.Visual;
        var area = display.BoundsPx;
        float scale = (float)Math.Max(1, display.Scale);
        visual.Offset = scene.Offset + new Vector3((float)dx / scale, (float)dy / scale, 0);
        var clip = scene.Viewport ??= visual.Compositor.CreateInsetClip();
        clip.LeftInset = (float)Math.Max(0, viewport.Left - area.X - dx) / scale;
        clip.TopInset = (float)Math.Max(0, viewport.Top - area.Y - dy) / scale;
        clip.RightInset = (float)Math.Max(0, area.Right + dx - viewport.Right) / scale;
        clip.BottomInset = (float)Math.Max(0, area.Bottom + dy - viewport.Bottom) / scale;
        visual.Clip = clip;
        visual.IsVisible = true;
    }

    public void Dispose()
    {
        cancelled.Cancel();
        cancelled.Dispose();
        ResetPlacement(restoreVisibility: false);
    }

    internal void ResetPlacement(bool restoreVisibility = true)
    {
        if (scene == null) return;
        scene.Visual.Offset = scene.Offset;
        scene.Visual.Clip = scene.Clip;
        if (restoreVisibility) scene.Visual.IsVisible = true;
        scene = null;
    }

    private sealed record CompositionVisualState(Visual Visual, Vector3 Offset, CompositionClip Clip)
    {
        internal InsetClip Viewport;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { internal int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Point { internal int X, Y; }

    private static bool TryClientBounds(nint hwnd, out Rect rect)
    {
        var origin = new Point();
        if (!GetClientRect(hwnd, out rect) || !ClientToScreen(hwnd, ref origin)) return false;
        rect.Left += origin.X;
        rect.Right += origin.X;
        rect.Top += origin.Y;
        rect.Bottom += origin.Y;
        return rect.Right > rect.Left && rect.Bottom > rect.Top;
    }

    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint window, uint flags);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint window);
    [DllImport("user32.dll")] private static extern bool GetClientRect(nint window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(nint window, ref Point point);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(nint window, StringBuilder text, int maximum);
}
