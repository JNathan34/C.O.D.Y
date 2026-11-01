using System.Runtime.InteropServices;

namespace HeyClicky.App.Cody;

public static class CodyDrawingSounds
{
    // The bundled XAudio2 source-voice call faults in x64 emulation on this
    // ARM64 machine. Speech uses the separate, working native WASAPI output.
    public static bool Supported => RuntimeInformation.OSArchitecture != Architecture.Arm64;
    public static void Prepare() { if (Supported) HeyClicky.Drawing.Audio.ScreenDrawingSounds.Prepare(); }
    public static void Play(string id, float gain, double delay, object owner)
    {
        if (Supported) HeyClicky.Drawing.Audio.ScreenDrawingSounds.Play(id, gain, delay, owner);
    }
}
