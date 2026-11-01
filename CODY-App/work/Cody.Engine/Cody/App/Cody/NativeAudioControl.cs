using System;
using System.Runtime.InteropServices;
using System.Text.Json;
namespace HeyClicky.App.Cody;

public static class NativeAudioControl
{
    [DllImport("ole32.dll", ExactSpelling=true)] private static extern int CoCreateInstance(ref Guid clsid, nint outer, uint context, ref Guid iid, out nint result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int DefaultDevice(nint self,int flow,int role,out nint device);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int Activate(nint self,ref Guid iid,uint context,nint args,out nint result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetScalar(nint self,out float value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int SetScalar(nint self,float value,nint context);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetMuted(nint self,out int value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int SetMuted(nint self,int value,nint context);
    private static T Slot<T>(nint instance,int slot) where T:Delegate => Marshal.GetDelegateForFunctionPointer<T>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(instance),slot*IntPtr.Size));
    private static T WithEndpoint<T>(Func<nint,T> action)
    {
        nint enumerator=0,device=0,volume=0;
        try
        {
            Guid clsid=new("BCDE0395-E52F-467C-8E3D-C4579291692E"),iid=new("A95664D2-9614-4F35-A746-DE8DB63617E6");
            Marshal.ThrowExceptionForHR(CoCreateInstance(ref clsid,0,23,ref iid,out enumerator));
            Marshal.ThrowExceptionForHR(Slot<DefaultDevice>(enumerator,4)(enumerator,0,1,out device));
            Guid volumeId=new("5CDF2C82-841E-4546-9722-0CF74078229A");
            Marshal.ThrowExceptionForHR(Slot<Activate>(device,3)(device,ref volumeId,23,0,out volume));
            return action(volume);
        }
        finally { if(volume!=0)Marshal.Release(volume);if(device!=0)Marshal.Release(device);if(enumerator!=0)Marshal.Release(enumerator); }
    }
    public static string State() => WithEndpoint(volume=>
    {
        Marshal.ThrowExceptionForHR(Slot<GetScalar>(volume,9)(volume,out float level));
        Marshal.ThrowExceptionForHR(Slot<GetMuted>(volume,15)(volume,out int muted));
        return JsonSerializer.Serialize(new { level=(int)Math.Round(level*100),muted=muted!=0 });
    });
    public static void SetVolume(int level) => WithEndpoint(volume=>MarshalResult(Slot<SetScalar>(volume,7)(volume,Math.Clamp(level,0,100)/100f,0)));
    public static void SetMute(bool muted) => WithEndpoint(volume=>MarshalResult(Slot<SetMuted>(volume,14)(volume,muted?1:0,0)));
    private static int MarshalResult(int result) { Marshal.ThrowExceptionForHR(result);return result; }
}
