using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
namespace HeyClicky.App.Cody;

// A temporary native cursor keeps the custom pointer aligned with the real click hotspot.
internal static class CodySystemCursor
{
    private static readonly object gate=new();
    private static readonly uint[] ids={32512,32513,32514,32515,32516,32642,32643,32644,32645,32646,32648,32649,32650,32651};
    private static readonly Dictionary<uint,nint> originals=new();
    private static string color="9d9dff";
    internal static bool Active{get{lock(gate)return originals.Count>0;}}
    internal static void Color(string value){lock(gate){color=value.TrimStart('#').ToLowerInvariant();if(originals.Count>0)Apply();}}
    internal static void Start(){lock(gate){if(originals.Count>0)return;try{foreach(uint id in ids){var copy=CopyIcon(LoadCursor(0,(nint)id));if(copy!=0)originals[id]=copy;}Apply();}catch{Restore();throw;}}}
    private static void Apply(){
        string file=Path.Combine(AppContext.BaseDirectory,"Assets","Cody","Cursors","cody-"+color+".cur");
        if(!File.Exists(file))file=Path.Combine(AppContext.BaseDirectory,"Assets","Cody","Cursors","cody-9d9dff.cur");
        nint cursor=LoadCursorFromFile(file);if(cursor==0)throw new InvalidOperationException("CODY's system cursor could not be loaded.");
        try{foreach(uint id in originals.Keys){nint copy=CopyIcon(cursor);if(copy==0||!SetSystemCursor(copy,id)){if(copy!=0)DestroyCursor(copy);throw new InvalidOperationException("Windows could not apply CODY's cursor.");}}}
        finally{DestroyCursor(cursor);}
    }
    internal static void Restore(){lock(gate){foreach(var pair in originals)if(!SetSystemCursor(pair.Value,pair.Key))DestroyCursor(pair.Value);originals.Clear();}}
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern nint LoadCursorFromFile(string file);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern nint LoadCursor(nint module,nint id);
    [DllImport("user32.dll")]private static extern nint CopyIcon(nint icon);
    [DllImport("user32.dll")]private static extern bool DestroyCursor(nint cursor);
    [DllImport("user32.dll")]private static extern bool SetSystemCursor(nint cursor,uint id);
}
