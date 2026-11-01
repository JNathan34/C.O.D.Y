using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace HeyClicky.App.Browser;

public static class ChromeInternalPages
{
	private struct KEYBDINPUT
	{
		public ushort wVk;

		public ushort wScan;

		public uint dwFlags;

		public uint time;

		public nint dwExtraInfo;
	}

	[StructLayout(LayoutKind.Explicit, Size = 40)]
	private struct INPUT
	{
		[FieldOffset(0)]
		public uint type;

		[FieldOffset(8)]
		public KEYBDINPUT ki;
	}

	private delegate bool EnumWindowsProc(nint hwnd, nint lParam);

	private const uint KEYEVENTF_KEYUP = 2u;

	private const uint KEYEVENTF_UNICODE = 4u;

	public static void Open(string browserExecutable, string url)
	{
		if (!url.StartsWith("chrome://", StringComparison.OrdinalIgnoreCase))
		{
			Launch(browserExecutable, url);
			return;
		}
		Task.Run(async () =>
		{
			HashSet<nint> before = BrowserWindows(browserExecutable);
			Launch(browserExecutable, "about:blank", newWindow: true);
			Stopwatch sw = Stopwatch.StartNew();
			while (sw.Elapsed < TimeSpan.FromSeconds(8L))
			{
				await Task.Delay(150);
				nint front = GetForegroundWindow();
				if (front != 0 && !before.Contains(front) && BrowserWindows(browserExecutable).Contains(front))
				{
					await Task.Delay(250);
					if (GetForegroundWindow() == front)
					{
						TypeText(url);
						PressEnter();
						Log.Info("Browser", $"opened {url} in a new {Path.GetFileNameWithoutExtension(browserExecutable)} window");
						return;
					}
				}
			}
			Log.Warn("Browser", "couldn't open " + url + ": the browser's new window never came to the front");
		});
	}

	private static void Launch(string exe, string url, bool newWindow = false)
	{
		ProcessStartInfo processStartInfo = new ProcessStartInfo(exe)
		{
			UseShellExecute = false
		};
		if (newWindow)
		{
			processStartInfo.ArgumentList.Add("--new-window");
		}
		processStartInfo.ArgumentList.Add(url);
		try
		{
			Process.Start(processStartInfo)?.Dispose();
		}
		catch (Exception ex)
		{
			Log.Warn("Browser", "open " + url + " failed: " + ex.Message);
		}
	}

	private static HashSet<nint> BrowserWindows(string exe)
	{
		string fileNameWithoutExtension = Path.GetFileNameWithoutExtension(exe);
		HashSet<uint> pids = Process.GetProcessesByName(fileNameWithoutExtension).Select((Process p) =>
		{
			using (p)
			{
				return (uint)p.Id;
			}
		}).ToHashSet();
		HashSet<nint> windows = new HashSet<nint>();
		EnumWindows((nint hwnd, nint _) =>
		{
			if (IsWindowVisible(hwnd) && GetWindowThreadProcessId(hwnd, out var pid) != 0 && pids.Contains(pid))
			{
				windows.Add(hwnd);
			}
			return true;
		}, 0);
		return windows;
	}

	private static void TypeText(string text)
	{
		List<INPUT> list = new List<INPUT>();
		foreach (char scan in text)
		{
			list.Add(Key(0, scan, 4u));
			list.Add(Key(0, scan, 6u));
		}
		SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf<INPUT>());
	}

	private static void PressEnter()
	{
		INPUT[] array = new INPUT[2]
		{
			Key(13, '\0', 0u),
			Key(13, '\0', 2u)
		};
		SendInput((uint)array.Length, array, Marshal.SizeOf<INPUT>());
	}

	private static INPUT Key(ushort vk, char scan, uint flags)
	{
		return new INPUT
		{
			type = 1u,
			ki = new KEYBDINPUT
			{
				wVk = vk,
				wScan = scan,
				dwFlags = flags
			}
		};
	}

	[DllImport("user32.dll")]
	private static extern bool EnumWindows(EnumWindowsProc proc, nint lParam);

	[DllImport("user32.dll")]
	private static extern bool IsWindowVisible(nint hwnd);

	[DllImport("user32.dll")]
	private static extern uint GetWindowThreadProcessId(nint hwnd, out uint pid);

	[DllImport("user32.dll")]
	private static extern nint GetForegroundWindow();

	[DllImport("user32.dll", SetLastError = true)]
	private static extern uint SendInput(uint count, INPUT[] inputs, int size);
}
