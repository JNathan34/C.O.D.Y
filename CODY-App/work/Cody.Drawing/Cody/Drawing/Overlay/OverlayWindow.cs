using System;
using System.Collections.Generic;
using System.Numerics;
using System.Runtime.InteropServices;
using HeyClicky.Drawing.Interop;
using Microsoft.UI.Input;
using Windows.Graphics;
using Windows.UI.Composition;
using Windows.UI.Composition.Desktop;

namespace HeyClicky.Drawing.Overlay;

internal sealed class OverlayWindow : IDisposable
{
	private struct CursorPoint
	{
		public int X;

		public int Y;
	}

	private const string ClassName = "HeyClickyDrawingWindow";

	private static NativeMethods.WndProc? classProcedure;

	private static bool classRegistered;

	private static readonly Dictionary<nint, OverlayWindow> windows = new Dictionary<nint, OverlayWindow>();

	internal static bool ExcludeFromCapture = true;

	private static readonly int OffscreenShift = ((Environment.GetEnvironmentVariable("HEYCLICKY_OFFSCREEN") == "1") ? (-24000) : 0);

	private readonly DesktopWindowTarget target;

	private readonly ContainerVisual pixelRoot;

	private double scale = 1.0;

	private readonly bool interactive;

	private bool tracking;

	private const uint GW_HWNDPREV = 3u;

	private nint shapeCursor;

	public nint Handle { get; }

	public ContainerVisual Root { get; }

	public RectInt32 BoundsPx { get; private set; }

	public bool IsShown { get; private set; }

	public double RasterizationScale => scale;

	public bool ShowsHandCursor { get; set; } = true;

	public nint CustomCursor { get; set; }

	public event Action<int, int>? PointerMoved;

	public event Action<int, int>? PointerPressed;

	public event Action<int, int>? PointerReleased;

	public event Action? PointerLeft;

	public OverlayWindow(Compositor compositor, string title, bool interactive = false, bool win32Input = false)
	{
		this.interactive = interactive;
		RegisterClass();
		int num = 136315016;
		if (!interactive)
		{
			num |= 0x80020;
		}
		Handle = NativeMethods.CreateWindowExW(num, "HeyClickyDrawingWindow", title, int.MinValue, 0, 0, 16, 16, IntPtr.Zero, IntPtr.Zero, NativeMethods.GetModuleHandleW(IntPtr.Zero), IntPtr.Zero);
		if (Handle == IntPtr.Zero)
		{
			throw new InvalidOperationException($"CreateWindowEx failed ({Marshal.GetLastWin32Error()})");
		}
		windows[Handle] = this;
		if (!interactive)
		{
			NativeMethods.SetLayeredWindowAttributes(Handle, 0u, byte.MaxValue, 2u);
		}
		if (ExcludeFromCapture && !NativeMethods.SetWindowDisplayAffinity(Handle, 17u))
		{
			Log.Warn("Drawing", $"SetWindowDisplayAffinity failed ({Marshal.GetLastWin32Error()}); the canvas may show in our own screenshots");
		}
		target = SystemComposition.CreateWindowTarget(compositor, Handle);
		pixelRoot = compositor.CreateContainerVisual();
		pixelRoot.RelativeSizeAdjustment = Vector2.One;
		target.Root = pixelRoot;
		Root = compositor.CreateContainerVisual();
		pixelRoot.Children.InsertAtTop(Root);
		Fit(16, 16);
	}

	private void Fit(int widthPx, int heightPx)
	{
		uint dpiForWindow = GetDpiForWindow(Handle);
		scale = ((dpiForWindow != 0) ? ((double)dpiForWindow / 96.0) : 1.0);
		Root.Scale = new Vector3((float)scale, (float)scale, 1f);
		Root.Size = new Vector2((float)((double)widthPx / scale), (float)((double)heightPx / scale));
	}

	public void ApplyCustomCursor(nint cursor)
	{
		CustomCursor = cursor;
		if (cursor != IntPtr.Zero)
		{
			ShowCursorIfOver(cursor);
		}
	}

	private void ShowCursorIfOver(nint cursor)
	{
		if (GetCursorPos(out var point) && WindowFromPoint(point) == Handle)
		{
			NativeMethods.SetCursor(cursor);
		}
	}

	[DllImport("user32.dll")]
	private static extern bool GetCursorPos(out CursorPoint point);

	[DllImport("user32.dll")]
	private static extern nint WindowFromPoint(CursorPoint point);

	[DllImport("user32.dll")]
	private static extern nint GetWindow(nint window, uint command);

	[DllImport("user32.dll")]
	private static extern uint GetDpiForWindow(nint window);

	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	private static extern int GetWindowTextW(nint window, char[] text, int maxCount);

	public static nint TopOfRunAbove(nint window, string title)
	{
		if (window == IntPtr.Zero)
		{
			return window;
		}
		char[] array = new char[title.Length + 2];
		nint num = window;
		for (int i = 0; i < 256; i++)
		{
			nint window2 = GetWindow(num, 3u);
			if (window2 == IntPtr.Zero)
			{
				break;
			}
			int windowTextW = GetWindowTextW(window2, array, array.Length);
			if (windowTextW != title.Length || !title.SequenceEqual(array.AsSpan(0, windowTextW)))
			{
				break;
			}
			num = window2;
		}
		return num;
	}

	public void SetHandCursor(bool hand)
	{
		ShowsHandCursor = hand;
		shapeCursor = IntPtr.Zero;
		if (interactive && CustomCursor == IntPtr.Zero)
		{
			ShowCursorIfOver(NativeMethods.LoadCursorW(IntPtr.Zero, hand ? NativeMethods.IDC_HAND : NativeMethods.IDC_ARROW));
		}
	}

	public void SetCursor(InputSystemCursorShape shape)
	{
		if (interactive)
		{
			shapeCursor = NativeMethods.LoadCursorW(name: shape switch
			{
				InputSystemCursorShape.Hand => NativeMethods.IDC_HAND, 
				InputSystemCursorShape.SizeAll => 32646, 
				InputSystemCursorShape.SizeWestEast => 32644, 
				InputSystemCursorShape.SizeNorthSouth => 32645, 
				InputSystemCursorShape.SizeNorthwestSoutheast => 32642, 
				InputSystemCursorShape.SizeNortheastSouthwest => 32643, 
				InputSystemCursorShape.IBeam => 32513, 
				InputSystemCursorShape.Cross => 32515, 
				_ => NativeMethods.IDC_ARROW, 
			}, instance: IntPtr.Zero);
			if (CustomCursor == IntPtr.Zero)
			{
				ShowCursorIfOver(shapeCursor);
			}
		}
	}

	private static void RegisterClass()
	{
		if (!classRegistered)
		{
			classProcedure = WindowProcedure;
			NativeMethods.WNDCLASSEXW windowClass = new NativeMethods.WNDCLASSEXW
			{
				cbSize = Marshal.SizeOf<NativeMethods.WNDCLASSEXW>(),
				lpfnWndProc = Marshal.GetFunctionPointerForDelegate(classProcedure),
				hInstance = NativeMethods.GetModuleHandleW(IntPtr.Zero),
				lpszClassName = Marshal.StringToHGlobalUni("HeyClickyDrawingWindow"),
				hCursor = NativeMethods.LoadCursorW(IntPtr.Zero, NativeMethods.IDC_ARROW)
			};
			if (NativeMethods.RegisterClassExW(ref windowClass) == 0)
			{
				throw new InvalidOperationException($"RegisterClassEx failed ({Marshal.GetLastWin32Error()})");
			}
			classRegistered = true;
		}
	}

	private static nint WindowProcedure(nint hwnd, uint message, nint wParam, nint lParam)
	{
		try
		{
			windows.TryGetValue(hwnd, out OverlayWindow value);
			switch (message)
			{
			case 33u:
				return 3;
			case 132u:
				if (value == null || !value.interactive)
				{
					return -1;
				}
				return 1;
			case 32u:
				if (value != null && value.interactive)
				{
					nint cursor;
					if (value.CustomCursor != IntPtr.Zero)
					{
						cursor = value.CustomCursor;
					}
					else
					{
						cursor = ((value.shapeCursor != IntPtr.Zero) ? value.shapeCursor : NativeMethods.LoadCursorW(IntPtr.Zero, value.ShowsHandCursor ? NativeMethods.IDC_HAND : NativeMethods.IDC_ARROW));
					}
					NativeMethods.SetCursor(cursor);
					return 1;
				}
				break;
			case 512u:
				if (value != null)
				{
					if (!value.tracking)
					{
						NativeMethods.TRACKMOUSEEVENT track = new NativeMethods.TRACKMOUSEEVENT
						{
							cbSize = Marshal.SizeOf<NativeMethods.TRACKMOUSEEVENT>(),
							dwFlags = 2u,
							hwndTrack = hwnd
						};
						value.tracking = NativeMethods.TrackMouseEvent(ref track);
					}
					value.PointerMoved?.Invoke(NativeMethods.LowWord(lParam), NativeMethods.HighWord(lParam));
					return IntPtr.Zero;
				}
				break;
			case 675u:
				if (value != null)
				{
					value.tracking = false;
					value.PointerLeft?.Invoke();
					return IntPtr.Zero;
				}
				break;
			case 513u:
				if (value != null)
				{
					NativeMethods.SetCapture(hwnd);
					value.PointerPressed?.Invoke(NativeMethods.LowWord(lParam), NativeMethods.HighWord(lParam));
					return IntPtr.Zero;
				}
				break;
			case 514u:
				if (value != null)
				{
					NativeMethods.ReleaseCapture();
					value.PointerReleased?.Invoke(NativeMethods.LowWord(lParam), NativeMethods.HighWord(lParam));
					return IntPtr.Zero;
				}
				break;
			}
		}
		catch (Exception ex)
		{
			Log.Error("Drawing", "window message failed", ex);
		}
		return NativeMethods.DefWindowProcW(hwnd, message, wParam, lParam);
	}

	public void ShowOver(RectInt32 boundsPx, nint justAbove = 0)
	{
		BoundsPx = boundsPx;
		NativeMethods.SetWindowPos(Handle, InsertAfterToBeAbove(justAbove), boundsPx.X + OffscreenShift, boundsPx.Y, boundsPx.Width, boundsPx.Height, 592u);
		Fit(boundsPx.Width, boundsPx.Height);
		if (!IsShown)
		{
			NativeMethods.ShowWindow(Handle, 8);
			IsShown = true;
			if (justAbove != IntPtr.Zero || FullscreenGuard.GameWindow() != IntPtr.Zero)
			{
				StackJustAbove(justAbove);
			}
		}
	}

	public void Reframe(RectInt32 boundsPx)
	{
		BoundsPx = boundsPx;
		NativeMethods.SetWindowPos(Handle, IntPtr.Zero, boundsPx.X + OffscreenShift, boundsPx.Y, boundsPx.Width, boundsPx.Height, 532u);
		Fit(boundsPx.Width, boundsPx.Height);
	}

	public void StackJustAbove(nint window)
	{
		NativeMethods.SetWindowPos(Handle, InsertAfterToBeAbove(window), 0, 0, 0, 0, 531u);
	}

	private nint InsertAfterToBeAbove(nint window)
	{
		nint num = ((window == IntPtr.Zero) ? IntPtr.Zero : GetWindow(window, 3u));
		if (num == IntPtr.Zero)
		{
			return FullscreenGuard.TopmostInsertAfter();
		}
		if (num != Handle)
		{
			return num;
		}
		nint window2 = GetWindow(Handle, 3u);
		if (window2 == IntPtr.Zero)
		{
			return FullscreenGuard.TopmostInsertAfter();
		}
		return window2;
	}

	public void SetBelow(nint window, bool isBelow)
	{
		nint insertAfter;
		if (isBelow)
		{
			insertAfter = ((window != IntPtr.Zero) ? window : NativeMethods.HWND_NOTTOPMOST);
		}
		else
		{
			insertAfter = FullscreenGuard.TopmostInsertAfter();
		}
		NativeMethods.SetWindowPos(Handle, insertAfter, 0, 0, 0, 0, 531u);
	}

	public void MoveTo(int x, int y)
	{
		BoundsPx = new RectInt32(x, y, BoundsPx.Width, BoundsPx.Height);
		NativeMethods.SetWindowPos(Handle, IntPtr.Zero, x + OffscreenShift, y, 0, 0, 533u);
	}

	public void Hide()
	{
		if (IsShown)
		{
			NativeMethods.ShowWindow(Handle, 0);
			IsShown = false;
		}
	}

	public void Dispose()
	{
		windows.Remove(Handle);
		try
		{
			target.Dispose();
		}
		catch
		{
		}
		NativeMethods.DestroyWindow(Handle);
	}
}
