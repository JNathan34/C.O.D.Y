using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Input.KeyboardAndMouse;

namespace HeyClicky.Platform.Input;

public static class KeyboardLayoutInfo
{
	private static nint cachedLayout;

	private static bool cachedHasAltGr;

	public static bool ForegroundLayoutHasAltGr()
	{
		HWND foregroundWindow = PInvoke.GetForegroundWindow();
		nint num = (nint)PInvoke.GetKeyboardLayout((!foregroundWindow.IsNull) ? PInvoke.GetWindowThreadProcessId(foregroundWindow, out var _) : 0u);
		if (num == cachedLayout && num != 0)
		{
			return cachedHasAltGr;
		}
		bool result = LayoutHasAltGr(num);
		cachedLayout = num;
		cachedHasAltGr = result;
		return result;
	}

	public static bool LayoutHasAltGr(nint layout)
	{
		for (char c = '!'; c <= 'ɏ'; c = (char)(c + 1))
		{
			short num = PInvoke.VkKeyScanEx(c, new HKL(layout));
			if (num != -1 && ((num >> 8) & 0xFF & 6) == 6)
			{
				return true;
			}
		}
		return false;
	}
}
