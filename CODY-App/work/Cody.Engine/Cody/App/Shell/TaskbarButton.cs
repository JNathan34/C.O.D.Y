using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace HeyClicky.App.Shell;

public sealed class TaskbarButton : IDisposable
{
	private delegate nint WndProc(nint hwnd, uint msg, nint wParam, nint lParam);

	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
	private struct WNDCLASSEX
	{
		public int cbSize;

		public uint style;

		public nint lpfnWndProc;

		public int cbClsExtra;

		public int cbWndExtra;

		public nint hInstance;

		public nint hIcon;

		public nint hCursor;

		public nint hbrBackground;

		public string? lpszMenuName;

		public string lpszClassName;

		public nint hIconSm;
	}

	private const string ClassName = "HeyClickyTaskbarButton";

	private const int WS_OVERLAPPEDWINDOW = 13565952;

	private const int WS_EX_APPWINDOW = 262144;

	private const int SW_HIDE = 0;

	private const int SW_SHOWMINNOACTIVE = 7;

	private const uint WM_SYSCOMMAND = 274u;

	private const uint WM_CLOSE = 16u;

	private const uint WM_SETICON = 128u;

	private const uint WM_QUERYOPEN = 19u;

	private const uint WM_ACTIVATE = 6u;

	private const int SC_RESTORE = 61728;

	private const int SC_MAXIMIZE = 61488;

	private const int SC_CLOSE = 61536;

	private const uint IMAGE_ICON = 1u;

	private const uint LR_LOADFROMFILE = 16u;

	private const uint LR_DEFAULTSIZE = 64u;

	private static WndProc? wndProc;

	private static bool classRegistered;

	private nint hwnd;

	private bool shown;

	private static readonly Dictionary<nint, TaskbarButton> instances = new Dictionary<nint, TaskbarButton>();

	private long lastClick;

	public event Action? Clicked;

	public event Action? CloseRequested;

	public TaskbarButton(string title, string iconPath)
	{
		nint moduleHandle = GetModuleHandle(null);
		if (!classRegistered)
		{
			wndProc = Proc;
			WNDCLASSEX wc = new WNDCLASSEX
			{
				cbSize = Marshal.SizeOf<WNDCLASSEX>(),
				lpfnWndProc = Marshal.GetFunctionPointerForDelegate(wndProc),
				hInstance = moduleHandle,
				lpszClassName = "HeyClickyTaskbarButton"
			};
			if (RegisterClassEx(ref wc) == 0)
			{
				Log.Warn("taskbar", $"register class failed ({Marshal.GetLastWin32Error()})");
				return;
			}
			classRegistered = true;
		}
		hwnd = CreateWindowEx(262144, "HeyClickyTaskbarButton", title, 13565952, -32000, -32000, 1, 1, 0, 0, moduleHandle, 0);
		if (hwnd == 0)
		{
			Log.Warn("taskbar", $"create window failed ({Marshal.GetLastWin32Error()})");
			return;
		}
		instances[hwnd] = this;
		(int, uint)[] array = new (int, uint)[2]
		{
			(0, 1u),
			(16, 0u)
		};
		for (int i = 0; i < array.Length; i++)
		{
			(int, uint) tuple = array[i];
			int item = tuple.Item1;
			uint item2 = tuple.Item2;
			nint num = LoadImage(0, iconPath, 1u, item, item, (uint)(0x10 | ((item == 0) ? 64 : 0)));
			if (num != 0)
			{
				SendMessage(hwnd, 128u, (nint)item2, num);
			}
		}
	}

	public void SetShown(bool show)
	{
		if (hwnd != 0 && show != shown)
		{
			shown = show;
			ShowWindow(hwnd, show ? 7 : 0);
			Log.Info("taskbar", show ? "button shown" : "button hidden");
		}
	}

	private void RaiseClicked()
	{
		long tickCount = Environment.TickCount64;
		if (tickCount - lastClick >= 400)
		{
			lastClick = tickCount;
			Clicked?.Invoke();
		}
	}

	private static nint Proc(nint h, uint msg, nint w, nint l)
	{
		if (instances.TryGetValue(h, out TaskbarButton value))
		{
			if (msg <= 16)
			{
				if (msg != 6)
				{
					if (msg == 16)
					{
						goto IL_006b;
					}
				}
				else if ((w & 0xFFFF) != 0)
				{
					return 0;
				}
			}
			else
			{
				if (msg == 19)
				{
					value.RaiseClicked();
					return 0;
				}
				if (msg == 274)
				{
					int num = (int)w & 0xFFF0;
					if ((num == 61488 || num == 61728) ? true : false)
					{
						value.RaiseClicked();
						return 0;
					}
					if (((int)w & 0xFFF0) == 61536)
					{
						goto IL_006b;
					}
				}
			}
		}
		return DefWindowProc(h, msg, w, l);
		IL_006b:
		value.CloseRequested?.Invoke();
		return 0;
	}

	public void Dispose()
	{
		if (hwnd != 0)
		{
			instances.Remove(hwnd);
			DestroyWindow(hwnd);
			hwnd = 0;
		}
	}

	[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
	private static extern ushort RegisterClassEx(ref WNDCLASSEX wc);

	[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
	private static extern nint CreateWindowEx(int exStyle, string className, string title, int style, int x, int y, int w, int h, nint parent, nint menu, nint instance, nint param);

	[DllImport("user32.dll", EntryPoint = "DefWindowProcW")]
	private static extern nint DefWindowProc(nint hwnd, uint msg, nint w, nint l);

	[DllImport("user32.dll")]
	private static extern bool ShowWindow(nint hwnd, int cmd);

	[DllImport("user32.dll")]
	private static extern bool DestroyWindow(nint hwnd);

	[DllImport("user32.dll")]
	private static extern nint SendMessage(nint hwnd, uint msg, nint w, nint l);

	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	private static extern nint LoadImage(nint instance, string name, uint type, int cx, int cy, uint load);

	[DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
	private static extern nint GetModuleHandle(string? name);
}
