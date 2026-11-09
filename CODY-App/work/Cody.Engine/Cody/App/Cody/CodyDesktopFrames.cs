using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace HeyClicky.App.Cody;

internal static class CodyDesktopFrames
{
    private const int CompletedFrame = 2;

    // Packed Win32 DWM_TIMING_INFO. cFrame counts compositions, while cRefresh
    // and rateRefresh describe display timing rather than rendered frames.
    [StructLayout(LayoutKind.Explicit, Size = 292)]
    private struct TimingInfo
    {
        [FieldOffset(0)] public uint Size;
        [FieldOffset(56)] public ulong ComposedFrame;
    }

    internal static object Snapshot()
    {
        ulong? frames;
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            frames = DCompositionGetFrameId(CompletedFrame, out ulong frame) >= 0 ? frame : null;
        }
        else
        {
            var timing = new TimingInfo { Size = (uint)Marshal.SizeOf<TimingInfo>() };
            frames = DwmGetCompositionTimingInfo(IntPtr.Zero, ref timing) >= 0 ? timing.ComposedFrame : null;
        }
        double time = Stopwatch.GetTimestamp() * 1000d / Stopwatch.Frequency;
        return new { frames, time };
    }

    [DllImport("dcomp.dll")]
    private static extern int DCompositionGetFrameId(int frameType, out ulong frame);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetCompositionTimingInfo(nint window, ref TimingInfo timing);
}
