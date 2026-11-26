using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace HeyClicky.App.Cody;

internal static class CodyIcueLighting
{
    private const string SdkVersion = "4.0.84";
    private const string SdkName = "iCUESDK.x64_2019.dll";
    private const string SdkEntry = "iCUESDK/redist/x64/" + SdkName;
    private const string ArchiveHash = "EB4414CF505145F3E507DC839AD587BF7CA684D64BE3D9A834F416A136736D5D";
    private const string LibraryHash = "D72FD819B91FD1D3B0C3DB2EA17A47DCFE3B38E26269AA967ECFEE10D2E93884";
    private const int MaxDevices = 64;
    private const int MaxLeds = 512;
    private const int Connected = 6;
    private const int ConnectionRefused = 4;
    private const int ConnectionLost = 5;
    private const int DeviceNotFound = 6;
    private const string AccessHelp = "Allow C.O.D.Y. under iCUE Settings → SDK → iCUE SDK, then choose Find devices.";
    private static readonly SemaphoreSlim Gate = new(1);
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15), MaxResponseContentBufferSize = 1024 * 1024 };
    private static readonly SessionChanged OnSessionChanged = SessionStateChanged;
    private static readonly List<LightingDevice> Devices = new();
    private static Sdk sdk;
    private static volatile TaskCompletionSource<int> connectResult;
    private static volatile int state;
    private static bool listening, hasLayer;

    internal static async Task<object> Discover()
    {
        await Gate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (!IcueIsRunning()) return new { running = false };
            try
            {
                if (sdk == null)
                {
                    string library = await PrepareSdk().ConfigureAwait(false);
                    try { sdk = new Sdk(library); }
                    catch (Exception error) when (error is DllNotFoundException or BadImageFormatException or EntryPointNotFoundException)
                    {
                        throw new InvalidOperationException("C.O.D.Y. couldn’t load the iCUE SDK on this PC.", error);
                    }
                }
                await Connect().ConfigureAwait(false);
                return new { running = true, devices = await Task.Run(ReadDevices).ConfigureAwait(false) };
            }
            catch
            {
                Disconnect();
                throw;
            }
        }
        finally { Gate.Release(); }
    }

    internal static async Task<object> SetColor(byte[] color)
    {
        await Gate.WaitAsync().ConfigureAwait(false);
        try
        {
            Check(state == Connected ? 0 : 1);
            return new { applied = await Task.Run(() => WriteColor(color)).ConfigureAwait(false) };
        }
        finally { Gate.Release(); }
    }

    internal static async Task Close()
    {
        await Gate.WaitAsync().ConfigureAwait(false);
        try { Disconnect(); }
        finally { Gate.Release(); }
    }

    private static bool IcueIsRunning()
    {
        var processes = Process.GetProcessesByName("iCUE");
        try { return processes.Length != 0; }
        finally { foreach (var process in processes) process.Dispose(); }
    }

    private static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data));

    private static async Task<string> PrepareSdk()
    {
        try
        {
            string directory = Path.Combine(CodyPaths.StateRoot, "icue-sdk", SdkVersion);
            string library = Path.Combine(directory, SdkName);
            if (File.Exists(library) && Hash(await File.ReadAllBytesAsync(library).ConfigureAwait(false)) == LibraryHash)
                return library;

            byte[] archive = await Http.GetByteArrayAsync(
                $"https://github.com/CorsairOfficial/cue-sdk/releases/download/v{SdkVersion}/iCUESDK_{SdkVersion}.zip").ConfigureAwait(false);
            if (Hash(archive) != ArchiveHash) throw new InvalidDataException("Invalid iCUE SDK archive checksum.");
            using var zip = new ZipArchive(new MemoryStream(archive), ZipArchiveMode.Read);
            using var entry = zip.GetEntry(SdkEntry)?.Open() ?? throw new InvalidDataException("iCUE SDK library is missing.");
            using var bytes = new MemoryStream();
            await entry.CopyToAsync(bytes).ConfigureAwait(false);
            byte[] dll = bytes.ToArray();
            if (Hash(dll) != LibraryHash) throw new InvalidDataException("Invalid iCUE SDK library checksum.");

            Directory.CreateDirectory(directory);
            string temporary = library + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                await File.WriteAllBytesAsync(temporary, dll).ConfigureAwait(false);
                File.Move(temporary, library, overwrite: true);
            }
            finally { File.Delete(temporary); }
            return library;
        }
        catch (Exception error)
        {
            Log.Warn("cody-icue", "Could not prepare iCUE SDK: " + error.GetType().Name);
            throw new InvalidOperationException("C.O.D.Y. couldn’t prepare the iCUE SDK. Check your internet connection and choose Find devices.", error);
        }
    }

    private static async Task Connect()
    {
        if (state == Connected) return;
        var result = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        connectResult = result;
        try
        {
            if (!listening)
            {
                Check(sdk.Connect(OnSessionChanged, IntPtr.Zero));
                listening = true;
            }
            if (state is Connected or ConnectionRefused) result.TrySetResult(state);
            if (await result.Task.WaitAsync(TimeSpan.FromSeconds(8)).ConfigureAwait(false) != Connected)
                throw new InvalidOperationException(AccessHelp);
        }
        catch (TimeoutException) { throw new InvalidOperationException("iCUE didn’t respond. " + AccessHelp); }
        finally { connectResult = null; }
    }

    private static void SessionStateChanged(IntPtr context, IntPtr data)
    {
        int next = Marshal.ReadInt32(data);
        int previous = state;
        state = next;
        if (next is Connected or ConnectionRefused) connectResult?.TrySetResult(next);
        if (previous == Connected && next is ConnectionLost or ConnectionRefused)
            CodyEngineBridge.PublishIcueDisconnected();
    }

    private static void Disconnect()
    {
        if (hasLayer && state == Connected)
        {
            try { WriteColor(null); }
            catch (InvalidOperationException error) { Log.Warn("cody-icue", error.Message); }
        }
        if (listening) sdk.Disconnect();
        listening = false;
        hasLayer = false;
        state = 0;
        Devices.Clear();
    }

    private static void Check(int error)
    {
        if (error == 0) return;
        throw new InvalidOperationException(error switch
        {
            1 or 7 => AccessHelp,
            2 => "Another application has exclusive control of iCUE lighting.",
            3 => "Update iCUE to use software lighting integrations.",
            _ => $"iCUE couldn’t complete the lighting operation (SDK error {error}). Choose Find devices to reconnect."
        });
    }

    // The structs and C calling convention match Corsair's iCUESDK.h from v4.0.84.
    private static unsafe object[] ReadDevices()
    {
        var items = new DeviceInfo[MaxDevices];
        int filter = -1; // All device types.
        int count;
        fixed (DeviceInfo* buffer = items)
            Check(sdk.GetDevices(&filter, MaxDevices, buffer, out count));
        var names = new List<object>();
        var positions = stackalloc LedPosition[MaxLeds];
        Devices.Clear();
        foreach (var item in items.AsSpan(0, count))
        {
            if (item.LedCount <= 0) continue;
            var device = item;
            int status = sdk.GetLedPositions(device.Id, MaxLeds, positions, out int ledCount);
            if (status == DeviceNotFound) continue;
            Check(status);
            if (ledCount <= 0) continue;
            string name = ReadText(new ReadOnlySpan<byte>(device.Model, 128));
            string id = ReadText(new ReadOnlySpan<byte>(device.Id, 128));
            uint[] leds = new uint[ledCount];
            for (int i = 0; i < leds.Length; i++) leds[i] = positions[i].Id;
            Devices.Add(new(Encoding.UTF8.GetBytes(id + "\0"), leds));
            names.Add(new { id = Devices.Count - 1, name = string.IsNullOrWhiteSpace(name) ? "iCUE device" : name });
        }
        return names.ToArray();
    }

    private static string ReadText(ReadOnlySpan<byte> bytes)
    {
        int end = bytes.IndexOf((byte)0);
        return Encoding.UTF8.GetString(end < 0 ? bytes : bytes[..end]);
    }

    private static unsafe int WriteColor(byte[] color)
    {
        var leds = stackalloc LedColor[MaxLeds];
        int applied = 0;
        foreach (var device in Devices)
        {
            for (int i = 0; i < device.Leds.Length; i++)
                leds[i] = color == null ? new() { Id = device.Leds[i] } :
                    new() { Id = device.Leds[i], R = color[0], G = color[1], B = color[2], A = 255 };
            fixed (byte* id = device.Id)
            {
                int status = sdk.SetLedColors(id, device.Leds.Length, leds);
                if (status == DeviceNotFound) continue;
                Check(status);
                if (color != null) hasLayer = true;
                applied++;
            }
        }
        if (color == null) hasLayer = false;
        return applied;
    }

    private sealed record LightingDevice(byte[] Id, uint[] Leds);
    [StructLayout(LayoutKind.Sequential)]
    private unsafe struct DeviceInfo
    {
        public int Type;
        public fixed byte Id[128], Serial[128], Model[128];
        public int LedCount, ChannelCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct LedPosition { public uint Id; public double X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct LedColor { public uint Id; public byte R, G, B, A; }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void SessionChanged(IntPtr context, IntPtr data);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int ConnectSdk(SessionChanged callback, IntPtr context);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int DisconnectSdk();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private unsafe delegate int GetDevicesSdk(int* filter, int max, DeviceInfo* devices, out int count);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private unsafe delegate int GetLedPositionsSdk(byte* id, int max, LedPosition* positions, out int count);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private unsafe delegate int SetLedColorsSdk(byte* id, int count, LedColor* colors);

    private sealed class Sdk
    {
        public readonly ConnectSdk Connect;
        public readonly DisconnectSdk Disconnect;
        public readonly GetDevicesSdk GetDevices;
        public readonly GetLedPositionsSdk GetLedPositions;
        public readonly SetLedColorsSdk SetLedColors;

        public Sdk(string path)
        {
            // Keep the SDK loaded for the lifetime of the engine because it owns callback threads.
            IntPtr library = NativeLibrary.Load(path);
            try
            {
                T Export<T>(string name) where T : Delegate => Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(library, name));
                Connect = Export<ConnectSdk>("CorsairConnect");
                Disconnect = Export<DisconnectSdk>("CorsairDisconnect");
                GetDevices = Export<GetDevicesSdk>("CorsairGetDevices");
                GetLedPositions = Export<GetLedPositionsSdk>("CorsairGetLedPositions");
                SetLedColors = Export<SetLedColorsSdk>("CorsairSetLedColors");
            }
            catch
            {
                NativeLibrary.Free(library);
                throw;
            }
        }
    }
}
