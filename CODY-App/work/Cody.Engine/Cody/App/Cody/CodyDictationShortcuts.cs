using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using HeyClicky.Core.Dictation;
namespace HeyClicky.App.Cody;

// Listen only for dictation; the Electron shortcut listener still owns Ctrl+Alt.
internal sealed class CodyDictationShortcuts:IDisposable
{
    private readonly DictationController dictation;
    private readonly Hook callback;
    private readonly KeyState keys=new();
    private nint hook;
    internal bool Installed=>hook!=0;
    internal CodyDictationShortcuts(DictationController dictation){
        this.dictation=dictation;dictation.HasDedicatedHandsFreeShortcut=false;callback=OnKey;
        hook=SetWindowsHookEx(13,callback,GetModuleHandle(null),0);
        if(hook==0)throw new Win32Exception(Marshal.GetLastWin32Error(),"Could not enable CODY dictation shortcuts.");
    }
    internal sealed class KeyState
    {
        private readonly HashSet<uint> pressed=new();private bool armed,cancelled,escape;
        internal bool Handle(uint key,bool down,bool up,nuint extra,bool allowed,Action<ShortcutAction> send,Func<bool> cancel){
            if(extra==1212369995)return false;
            if(key==27){if(up){bool handled=escape;escape=false;return handled;}if(escape)return true;if(down&&cancel()){escape=true;return true;}}
            if(down&&!pressed.Add(key))return false;if(up)pressed.Remove(key);
            bool ctrl=pressed.Contains(17)||pressed.Contains(162)||pressed.Contains(163),win=pressed.Contains(91)||pressed.Contains(92);
            bool other=pressed.Contains(16)||pressed.Contains(160)||pressed.Contains(161)||pressed.Contains(18)||pressed.Contains(164)||pressed.Contains(165);
            bool combo=ctrl&&win&&!other;
            if(!armed&&combo&&allowed){armed=true;cancelled=false;send(ShortcutAction.DictationDown);}
            else if(armed&&!combo){armed=false;send(ShortcutAction.DictationUp);}
            if(armed&&down&&!cancelled&&key is not (17 or 162 or 163 or 91 or 92 or 16 or 160 or 161 or 18 or 164 or 165)){cancelled=true;send(ShortcutAction.DictationCancel);}
            return false;
        }
    }
    private nint OnKey(int code,nint message,nint data){
        if(code>=0){var key=Marshal.PtrToStructure<KeyEvent>(data);if(keys.Handle(key.Key,message==0x100||message==0x104,message==0x101||message==0x105,key.Extra,!CodyIndependentInput.Active&&!CodyEngineBridge.MicrophoneMuted,dictation.HandleShortcut,dictation.CancelActiveSession))return 1;}
        return CallNextHookEx(hook,code,message,data);
    }
    public void Dispose(){if(hook!=0){UnhookWindowsHookEx(hook);hook=0;}}
    private delegate nint Hook(int code,nint message,nint data);
    [StructLayout(LayoutKind.Sequential)]private struct KeyEvent{public uint Key,Scan,Flags,Time;public nuint Extra;}
    [DllImport("user32.dll",SetLastError=true)]private static extern nint SetWindowsHookEx(int kind,Hook callback,nint module,uint thread);
    [DllImport("user32.dll")]private static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("user32.dll")]private static extern nint CallNextHookEx(nint hook,int code,nint message,nint data);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]private static extern nint GetModuleHandle(string name);
}
