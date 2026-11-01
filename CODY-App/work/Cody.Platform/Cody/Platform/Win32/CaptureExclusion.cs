using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.WindowsAndMessaging;

namespace HeyClicky.Platform.Win32;

public static class CaptureExclusion
{
	public static bool Enabled { get; set; } = true;

	public static bool Apply(nint hwnd)
	{
		if (!Enabled)
		{
			return true;
		}
		HWND hWnd = new HWND(hwnd);
		if ((bool)PInvoke.SetWindowDisplayAffinity(hWnd, WINDOW_DISPLAY_AFFINITY.WDA_EXCLUDEFROMCAPTURE))
		{
			return true;
		}
		Log.Warn("CaptureExclusion", $"WDA_EXCLUDEFROMCAPTURE failed for 0x{hwnd:X} (error {Marshal.GetLastWin32Error()}); falling back to WDA_MONITOR");
		PInvoke.SetWindowDisplayAffinity(hWnd, WINDOW_DISPLAY_AFFINITY.WDA_MONITOR);
		return false;
	}

	public static void Remove(nint hwnd)
	{
		PInvoke.SetWindowDisplayAffinity(new HWND(hwnd), WINDOW_DISPLAY_AFFINITY.WDA_NONE);
	}
}
