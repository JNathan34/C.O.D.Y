using System;
using System.Threading;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace HeyClicky.App.Cody;

// Esc is consumed only while Cody has cancellable work. Other keys and mouse input pass through.
internal sealed class CodyEscapeTakeBack : IDisposable
{
    private readonly Action takeBack;
    private readonly Func<bool> available;
    private readonly Hook callback;
    private nint hook;
    private int disposed;
    private readonly KeyState keys=new();
    internal CodyEscapeTakeBack(Action takeBack,Func<bool> available=null)
    {
        this.takeBack=takeBack;this.available=available??(()=>true);callback=OnKey;
        hook=SetWindowsHookEx(13,callback,GetModuleHandle(null),0);
        if(hook==0)throw new Win32Exception(Marshal.GetLastWin32Error(),"Could not enable Esc take-back.");
    }
    internal static bool ShouldTakeBack(uint key,bool down,nuint extraInfo)=>key==0x1B&&down&&extraInfo!=1212369995;
    internal sealed class KeyState{
        private bool held;
        internal bool Handle(uint key,bool down,bool up,nuint extra,Func<bool> available,Action cancel){
            if(key!=27||extra==1212369995)return false;
            if(up){bool consumed=held;held=false;return consumed;}
            if(held)return true;
            if(down&&available()){held=true;cancel();return true;}
            return false;
        }
    }
    private nint OnKey(int code,nint message,nint data)
    {
        if(code>=0&&Volatile.Read(ref disposed)==0){
            var key=Marshal.PtrToStructure<KeyEvent>(data);
            if(keys.Handle(key.Key,message==0x100||message==0x104,message==0x101||message==0x105,key.ExtraInfo,available,takeBack))return 1;
        }
        return CallNextHookEx(hook,code,message,data);
    }
    public void Dispose()
    {
        if(Interlocked.Exchange(ref disposed,1)==0&&hook!=0){UnhookWindowsHookEx(hook);hook=0;}
    }
    private delegate nint Hook(int code,nint message,nint data);
    [StructLayout(LayoutKind.Sequential)]private struct KeyEvent{public uint Key,Scan,Flags,Time;public nuint ExtraInfo;}
    [DllImport("user32.dll",SetLastError=true)]private static extern nint SetWindowsHookEx(int kind,Hook callback,nint module,uint thread);
    [DllImport("user32.dll")]private static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("user32.dll")]private static extern nint CallNextHookEx(nint hook,int code,nint message,nint data);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]private static extern nint GetModuleHandle(string name);
}
