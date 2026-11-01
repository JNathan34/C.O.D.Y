using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using HeyClicky.App.Design;
using HeyClicky.App.Interop;
using HeyClicky.App.Shell;
using HeyClicky.App.UI;
using HeyClicky.Drawing.Overlay;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;
using Windows.UI;

namespace HeyClicky.App.Browser;

public sealed class ChromeFolderStrip
{
	private struct RECT
	{
		public int Left;

		public int Top;

		public int Right;

		public int Bottom;
	}

	private delegate bool EnumWindowsProc(nint hwnd, nint lParam);

	public const double Width = 440.0;

	public const double Height = 86.0;

	private const double ShadowMargin = 18.0;

	private OverlayWindow? window;

	private DispatcherQueueTimer? follow;

	private string browserProcess = "";

	private bool isPointerOnFolder;

	private readonly List<WindowSubclass> cursorSubclasses = new List<WindowSubclass>();

	public System.Drawing.Rectangle? FrameOnScreen
	{
		get
		{
			OverlayWindow overlayWindow = window;
			if ((object)overlayWindow == null || !overlayWindow.IsShown)
			{
				return null;
			}
			(int X, int Y, int W, int H) rectPx = overlayWindow.RectPx;
			int item = rectPx.X;
			int item2 = rectPx.Y;
			int item3 = rectPx.W;
			int item4 = rectPx.H;
			int num = (int)Math.Round(18.0 * overlayWindow.Scale);
			return new System.Drawing.Rectangle(item + num, item2 + num, item3 - 2 * num, item4 - 2 * num);
		}
	}

	public double Scale => window?.Scale ?? 1.0;

	public void Show(string folder, string browserExecutable, string browserName, Action onClose)
	{
		Hide();
		browserProcess = System.IO.Path.GetFileNameWithoutExtension(browserExecutable);
		OverlayWindow overlayWindow = new OverlayWindow("CODY for " + browserName, excludeFromCapture: false, clickThroughEverywhere: false, activatable: true);
		overlayWindow.Root.RequestedTheme = ElementTheme.Light;
		overlayWindow.Root.Children.Add(BuildContent(folder, browserName, onClose));
		window = overlayWindow;
		Follow();
		follow = DispatcherQueue.GetForCurrentThread().CreateTimer();
		follow.Interval = TimeSpan.FromSeconds(0.25);
		follow.Tick += (DispatcherQueueTimer _, object _) =>
		{
			Follow();
		};
		follow.Rooted().Start();
	}

	public void Hide()
	{
		if ((object)follow != null)
		{
			TimerRoots.Release(follow);
		}
		foreach (WindowSubclass cursorSubclass in cursorSubclasses)
		{
			cursorSubclass.Dispose();
		}
		cursorSubclasses.Clear();
		isPointerOnFolder = false;
		follow = null;
		OverlayWindow overlayWindow = window;
		if ((object)overlayWindow != null)
		{
			overlayWindow.HideWindow();
			try
			{
				overlayWindow.Close();
			}
			catch
			{
			}
		}
		window = null;
	}

	private void Follow()
	{
		OverlayWindow overlayWindow = window;
		if ((object)overlayWindow == null)
		{
			return;
		}
		System.Drawing.Rectangle? rectangle = BrowserWindowFrame();
		if (rectangle.HasValue)
		{
			System.Drawing.Rectangle valueOrDefault = rectangle.GetValueOrDefault();
			double num = Displays.DpiAt(valueOrDefault.Left + valueOrDefault.Width / 2, valueOrDefault.Bottom - 10) / 96.0;
			int num2 = (int)Math.Round(476.0 * num);
			int num3 = (int)Math.Round(122.0 * num);
			int num4 = valueOrDefault.Left + valueOrDefault.Width / 2 - num2 / 2;
			int num5 = valueOrDefault.Bottom - (int)Math.Round(22.0 * num) - (int)Math.Round(104.0 * num);
			var (num6, num7, num8, num9) = overlayWindow.RectPx;
			if (!overlayWindow.IsShown || num6 != num4 || num7 != num5 || num8 != num2 || num9 != num3)
			{
				overlayWindow.PlacePx(num4, num5, num2, num3);
			}
			if (!overlayWindow.IsShown)
			{
				overlayWindow.ShowNoActivate();
			}
			if (cursorSubclasses.Count == 0)
			{
				KeepOpenHandOverFolder(overlayWindow);
			}
		}
		else if (overlayWindow.IsShown)
		{
			overlayWindow.HideWindow();
		}
	}

	private FrameworkElement BuildContent(string folder, string browserName, Action onClose)
	{
		Windows.UI.Color color = DS.Rgb(0.08, 0.09, 0.12);
		Windows.UI.Color color2 = DS.Rgb(0.36, 0.38, 0.44);
		Windows.UI.Color color3 = DS.Rgb(0.55, 0.58, 0.64);
		Windows.UI.Color color4 = DS.Rgb(0.2, 0.5, 1.0);
		Border border = new Border
		{
			Width = 44.0,
			Height = 44.0,
			CornerRadius = new CornerRadius(10.0)
		};
		string text = System.IO.Path.Combine(folder, "icons", "128.png");
		if (File.Exists(text))
		{
			border.Background = new ImageBrush
			{
				ImageSource = new BitmapImage(new Uri(text)),
				Stretch = Stretch.UniformToFill
			};
		}
		Border item = new Border
		{
			Width = 18.0,
			Height = 18.0,
			CornerRadius = new CornerRadius(9.0),
			Background = Ui.Brush(color4),
			BorderBrush = Ui.Brush(Colors.White),
			BorderThickness = new Thickness(1.5),
			HorizontalAlignment = HorizontalAlignment.Right,
			VerticalAlignment = VerticalAlignment.Bottom,
			Margin = new Thickness(0.0, 0.0, -5.0, -5.0),
			Child = Icons.Glyph("\uea86", 9.0, Colors.White).Center()
		};
		Grid grid = new Grid
		{
			Width = 44.0,
			Height = 44.0,
			Children = 
			{
				(UIElement)border,
				(UIElement)item
			}
		};
		StackPanel stackPanel = Ui.V(2.0, Ui.Text("CODY for " + browserName, 13.5, FontWeights.SemiBold, color), Ui.Text("Drag me onto this page to add me", 12.0, FontWeights.Normal, color4), Ui.Text("Developer mode on first (top right)", 11.0, FontWeights.Normal, color3));
		stackPanel.VerticalAlignment = VerticalAlignment.Center;
		TextBlock textBlock = Icons.Glyph("\ue7c9", 15.0, color4.WithAlpha(0.85));
		textBlock.VerticalAlignment = VerticalAlignment.Center;
		Grid grid2 = new Grid
		{
			Padding = new Thickness(12.0, 0.0, 12.0, 0.0),
			ColumnSpacing = 12.0,
			Background = Ui.Transparent,
			CanDrag = true
		};
		grid2.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = GridLength.Auto
		});
		grid2.ColumnDefinitions.Add(new ColumnDefinition());
		grid2.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = GridLength.Auto
		});
		grid.VerticalAlignment = VerticalAlignment.Center;
		Grid.SetColumn(stackPanel, 1);
		Grid.SetColumn(textBlock, 2);
		grid2.Children.Add(grid);
		grid2.Children.Add(stackPanel);
		grid2.Children.Add(textBlock);
		grid2.PointerEntered += (object _, PointerRoutedEventArgs _) =>
		{
			isPointerOnFolder = true;
			ShowOpenHand();
		};
		grid2.PointerMoved += (object _, PointerRoutedEventArgs _) =>
		{
			ShowOpenHand();
		};
		grid2.PointerExited += (object _, PointerRoutedEventArgs _) =>
		{
			isPointerOnFolder = false;
		};
		grid2.DragStarting += async (UIElement _, DragStartingEventArgs args) =>
		{
			DragOperationDeferral deferral = args.GetDeferral();
			try
			{
				StorageFolder item6 = await StorageFolder.GetFolderFromPathAsync(folder);
				args.Data.SetStorageItems(new _003C_003Ez__ReadOnlySingleElementList<IStorageItem>(item6));
				args.Data.RequestedOperation = DataPackageOperation.Copy;
				args.AllowedOperations = DataPackageOperation.Copy | DataPackageOperation.Link;
			}
			catch (Exception ex)
			{
				Log.Warn("Browser", "strip drag: " + ex.Message);
				args.Cancel = true;
			}
			finally
			{
				deferral.Complete();
			}
		};
		AutomationProperties.SetName(grid2, "CODY for " + browserName + ", the Chrome extension. Drag it onto the Extensions page to add it.");
		Microsoft.UI.Xaml.Shapes.Rectangle item2 = new Microsoft.UI.Xaml.Shapes.Rectangle
		{
			RadiusX = 12.0,
			RadiusY = 12.0,
			Stroke = Ui.Brush(color4.WithAlpha(0.5)),
			StrokeThickness = 1.2,
			StrokeDashArray = new DoubleCollection { 3.3333333333333335, 2.5 },
			Fill = Ui.Brush(color4.WithAlpha(0.07)),
			IsHitTestVisible = false
		};
		Grid item3 = new Grid
		{
			Children = 
			{
				(UIElement)item2,
				(UIElement)grid2
			}
		};
		Pressable pressable = new Pressable
		{
			Width = 24.0,
			Height = 24.0,
			CornerRadius = new CornerRadius(12.0),
			Background = Ui.Brush(DS.Black(0.05)),
			VerticalAlignment = VerticalAlignment.Center
		};
		TextBlock textBlock2 = Icons.Glyph("\ue711", 9.0, color2);
		textBlock2.FontWeight = FontWeights.Bold;
		pressable.Children.Add(textBlock2.Center());
		pressable.Click += onClose;
		AutomationProperties.SetName(pressable, "Close");
		Grid grid3 = new Grid
		{
			ColumnSpacing = 12.0,
			Padding = new Thickness(10.0)
		};
		grid3.ColumnDefinitions.Add(new ColumnDefinition());
		grid3.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = GridLength.Auto
		});
		Grid.SetColumn(pressable, 1);
		grid3.Children.Add(item3);
		grid3.Children.Add(pressable);
		Border item4 = new Border
		{
			Width = 440.0,
			Height = 86.0,
			CornerRadius = new CornerRadius(18.0),
			Background = Ui.Brush(Colors.White),
			BorderBrush = Ui.Brush(DS.Black(0.08)),
			BorderThickness = new Thickness(1.0),
			Child = grid3
		};
		ShadowLayer item5 = new ShadowLayer(18.0, DS.Black(0.25), 12.0, 4.0)
		{
			Width = 440.0,
			Height = 86.0
		};
		return new Grid
		{
			Margin = new Thickness(18.0),
			Width = 440.0,
			Height = 86.0,
			Children = 
			{
				(UIElement)item5,
				(UIElement)item4
			}
		};
	}

	private void ShowOpenHand()
	{
		OverlayWindow overlayWindow = window;
		if ((object)overlayWindow != null)
		{
			SetCursor(GrabCursors.Get(closed: false, Native.GetDpiForWindow(overlayWindow.Hwnd)));
		}
	}

	private void KeepOpenHandOverFolder(OverlayWindow w)
	{
		foreach (WindowSubclass cursorSubclass in cursorSubclasses)
		{
			cursorSubclass.Dispose();
		}
		cursorSubclasses.Clear();
		foreach (nint item in new nint[1] { w.Hwnd }.Concat(Native.DirectChildren(w.Hwnd)))
		{
			cursorSubclasses.Add(new WindowSubclass(item, (nint _, uint msg, nint _, nint l) =>
			{
				if (msg != 32 || !isPointerOnFolder || (long)(l & 0xFFFF) != 1)
				{
					return (nint?)null;
				}
				ShowOpenHand();
				return 1;
			}));
		}
	}

	[DllImport("user32.dll")]
	private static extern nint SetCursor(nint cursor);

	public System.Drawing.Rectangle? BrowserWindowFrame()
	{
		if (browserProcess.Length == 0)
		{
			return null;
		}
		HashSet<uint> pids = Process.GetProcessesByName(browserProcess).Select((Process p) =>
		{
			using (p)
			{
				return (uint)p.Id;
			}
		}).ToHashSet();
		if (pids.Count == 0)
		{
			return null;
		}
		System.Drawing.Rectangle? found = null;
		EnumWindows((nint hwnd, nint _) =>
		{
			if (!IsWindowVisible(hwnd) || IsIconic(hwnd) || GetWindowTextLength(hwnd) == 0)
			{
				return true;
			}
			GetWindowThreadProcessId(hwnd, out var pid);
			if (!pids.Contains(pid))
			{
				return true;
			}
			if (DwmGetWindowAttribute(hwnd, 14, out int value, 4) == 0 && value != 0)
			{
				return true;
			}
			if (DwmGetWindowAttribute(hwnd, 9, out RECT value2, Marshal.SizeOf<RECT>()) != 0 && !GetWindowRect(hwnd, out value2))
			{
				return true;
			}
			if (value2.Right - value2.Left < 200 || value2.Bottom - value2.Top < 150)
			{
				return true;
			}
			found = new System.Drawing.Rectangle(value2.Left, value2.Top, value2.Right - value2.Left, value2.Bottom - value2.Top);
			return false;
		}, 0);
		return found;
	}

	[DllImport("user32.dll")]
	private static extern bool EnumWindows(EnumWindowsProc proc, nint lParam);

	[DllImport("user32.dll")]
	private static extern bool IsWindowVisible(nint hwnd);

	[DllImport("user32.dll")]
	private static extern bool IsIconic(nint hwnd);

	[DllImport("user32.dll")]
	private static extern int GetWindowTextLength(nint hwnd);

	[DllImport("user32.dll")]
	private static extern uint GetWindowThreadProcessId(nint hwnd, out uint pid);

	[DllImport("user32.dll")]
	private static extern bool GetWindowRect(nint hwnd, out RECT rect);

	[DllImport("dwmapi.dll")]
	private static extern int DwmGetWindowAttribute(nint hwnd, int attribute, out RECT value, int size);

	[DllImport("dwmapi.dll")]
	private static extern int DwmGetWindowAttribute(nint hwnd, int attribute, out int value, int size);
}
