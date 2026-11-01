namespace HeyClicky.Platform.Input;

internal readonly struct LowLevelKeyEvent(uint virtualKey, uint scanCode, uint flags, uint timeMs, bool isDown, nuint extraInfo)
{
	public readonly uint VirtualKey = virtualKey;

	public readonly uint ScanCode = scanCode;

	public readonly uint Flags = flags;

	public readonly uint TimeMs = timeMs;

	public readonly bool IsDown = isDown;

	public readonly nuint ExtraInfo = extraInfo;

	public bool IsInjected => (Flags & 0x10) != 0;

	public bool IsExtended => (Flags & 1) != 0;
}
