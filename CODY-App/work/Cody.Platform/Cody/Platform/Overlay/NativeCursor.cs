using System.CodeDom.Compiler;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using Windows.Win32.Foundation;
using Windows.Win32.UI.WindowsAndMessaging;

namespace HeyClicky.Platform.Overlay;

internal static class NativeCursor
{
	private struct TRACKMOUSEEVENT
	{
		public uint cbSize;

		public uint dwFlags;

		public nint hwndTrack;

		public uint dwHoverTime;
	}

	public const uint WM_MOUSELEAVE = 675u;

	[LibraryImport("user32.dll", SetLastError = true)]
	[GeneratedCode("Microsoft.Interop.LibraryImportGenerator", "9.0.15.404")]
	[SkipLocalsInit]
	[return: MarshalAs(UnmanagedType.Bool)]
	private unsafe static bool TrackMouseEvent(ref TRACKMOUSEEVENT eventTrack)
	{
		int num;
		int lastSystemError;
		fixed (TRACKMOUSEEVENT* _eventTrack_native = &eventTrack)
		{
			Marshal.SetLastSystemError(0);
			num = __PInvoke(_eventTrack_native);
			lastSystemError = Marshal.GetLastSystemError();
		}
		bool result = num != 0;
		Marshal.SetLastPInvokeError(lastSystemError);
		return result;
		[DllImport("user32.dll", EntryPoint = "TrackMouseEvent", ExactSpelling = true)]
		unsafe static extern int __PInvoke(TRACKMOUSEEVENT* __eventTrack_native);
	}

	[DllImport("user32.dll", EntryPoint = "LoadCursorW", ExactSpelling = true)]
	[LibraryImport("user32.dll", EntryPoint = "LoadCursorW")]
	private static extern nint LoadCursor(nint instance, nint cursorName);

	public static bool TrackLeave(HWND window)
	{
		TRACKMOUSEEVENT eventTrack = new TRACKMOUSEEVENT
		{
			cbSize = (uint)Marshal.SizeOf<TRACKMOUSEEVENT>(),
			dwFlags = 2u,
			hwndTrack = (nint)window
		};
		return TrackMouseEvent(ref eventTrack);
	}

	public static HCURSOR LoadArrow()
	{
		return new HCURSOR(LoadCursor(0, 32649));
	}
}
