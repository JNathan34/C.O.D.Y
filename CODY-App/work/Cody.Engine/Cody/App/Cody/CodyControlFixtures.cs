using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Automation;
using WinRT.Interop;
namespace HeyClicky.App.Cody;
// Isolated real Windows controls used only by the explicit local verification command.
internal static class CodyControlFixtures
{
    private static Window modern;
    private static StackPanel panel;
    private static Button modernButton;
    private static TextBox modernText,address;
    private static CheckBox modernCheck;
    private static ListView modernList;
    private static nint native,button,edit,check,list;
    private static int nativeClicks,nativeOpens,modernClicks,modernOpens;
    private static readonly WindowProcedure procedure=WndProc;
    private const string NativeClass="CODYControlVerificationNative";
    private static bool registered;
    private static nint ModernHandle=>modern==null?0:WindowNative.GetWindowHandle(modern);
    internal static bool Owns(nint handle)=>handle!=0&&(handle==native||handle==ModernHandle);
    internal static object Create(){
        Close();nativeClicks=nativeOpens=modernClicks=modernOpens=0;
        var area=Microsoft.UI.Windowing.DisplayArea.Primary.WorkArea;
        if(!registered){var c=new WindowClass{size=(uint)Marshal.SizeOf<WindowClass>(),instance=GetModuleHandle(null),procedure=Marshal.GetFunctionPointerForDelegate(procedure),className=NativeClass,cursor=LoadCursor(0,(nint)32512),background=(nint)6};if(RegisterClassEx(ref c)==0)throw new InvalidOperationException("Could not register verification window.");registered=true;}
        var common=new CommonControls{size=8,classes=1};InitCommonControlsEx(ref common);
        native=CreateWindowEx(0,NativeClass,"CODY native control verification",0x10CF0000,area.X+30,area.Y+180,540,470,0,0,GetModuleHandle(null),0);
        button=Child("BUTTON","Open fixture",0x00000000,20,20,180,34,101);
        Child("STATIC","Text field",0,20,65,240,20,110);edit=Child("EDIT","Existing text",0x00800080,20,88,280,32,102);
        check=Child("BUTTON","Independent checkbox",3,20,135,250,30,103);
        list=Child("SysListView32","",0x0000000D|0x00800000,20,180,350,160,104);
        var column=new ListColumn{mask=3,width=320,text=Marshal.StringToHGlobalUni("Double click an item")};try{SendMessageStruct(list,0x1061,0,ref column);}finally{Marshal.FreeHGlobal(column.text);}
        var item=new ListItem{mask=1,text=Marshal.StringToHGlobalUni("Open this fixture item")};try{SendMessageStruct(list,0x104D,0,ref item);}finally{Marshal.FreeHGlobal(item.text);}
        modern=new Window{Title="CODY WinUI control verification"};panel=new StackPanel{Margin=new Thickness(24),Spacing=12};
        modernButton=new Button{Content="Open fixture",Width=200};modernButton.Click+=(_,_)=>modernClicks++;
        modernText=new TextBox{Header="Text field",Text="Existing text",Width=300,HorizontalAlignment=HorizontalAlignment.Left};
        address=new TextBox{Header="Address and search bar",Text="https://fixture.invalid/",Width=300,HorizontalAlignment=HorizontalAlignment.Left};AutomationProperties.SetName(address,"Address and search bar");
        modernCheck=new CheckBox{Content="Independent checkbox"};modernList=new ListView{Width=300,Height=80,IsItemClickEnabled=true,HorizontalAlignment=HorizontalAlignment.Left};modernList.Items.Add("Open this fixture item");modernList.ItemClick+=(_,_)=>modernOpens++;
        foreach(var control in new FrameworkElement[]{modernButton,modernText,address,modernCheck,modernList})panel.Children.Add(control);
        modern.Content=panel;modern.AppWindow.MoveAndResize(new Windows.Graphics.RectInt32(area.X+620,area.Y+180,640,720));modern.Activate();
        // Keep only these disposable fixtures above unrelated apps during verification.
        SetWindowPos(native,(nint)(-1),0,0,0,0,0x13);SetWindowPos(ModernHandle,(nint)(-1),0,0,0,0,0x13);
        return State();
    }
    private static nint Child(string cls,string title,uint style,int x,int y,int width,int height,int id)=>CreateWindowEx(0,cls,title,0x50000000|style,x,y,width,height,native,(nint)id,GetModuleHandle(null),0);
    private static nint WndProc(nint hwnd,uint msg,nint w,nint l){
        if(msg==0x111&&(w.ToInt64()&0xFFFF)==101)nativeClicks++;
        if(msg==0x4E){var header=Marshal.PtrToStructure<NotifyHeader>(l);if(header.id==(nuint)104&&header.code is -3 or -114)nativeOpens++;}
        return DefWindowProc(hwnd,msg,w,l);
    }
    private static object Bounds(nint handle){GetWindowRect(handle,out var r);return new{x=(r.left+r.right)/2.0,y=(r.top+r.bottom)/2.0,width=r.right-r.left,height=r.bottom-r.top};}
    private static object Bounds(FrameworkElement element){if(element?.XamlRoot==null)return new{x=0.0,y=0.0,width=0.0,height=0.0};var point=element.TransformToVisual(panel).TransformPoint(new Windows.Foundation.Point(0,0));var origin=new NativePoint();ClientToScreen(ModernHandle,ref origin);var scale=element.XamlRoot.RasterizationScale;return new{x=origin.x+(point.X+panel.Margin.Left+element.ActualWidth/2)*scale,y=origin.y+(point.Y+panel.Margin.Top+(element is TextBox?element.ActualHeight-16:element.ActualHeight/2))*scale,width=element.ActualWidth*scale,height=element.ActualHeight*scale};}
    internal static object State(){var text=new StringBuilder(4096);if(edit!=0)GetWindowText(edit,text,text.Capacity);return new{
        native=new{handle=native.ToString(),button=Bounds(button),edit=Bounds(edit),check=Bounds(check),item=ListPoint(),minimize=MinimizePoint(),clicks=nativeClicks,opens=nativeOpens,text=text.ToString(),checkedValue=check!=0&&SendMessage(check,0xF0,0,0)!=0,minimized=native!=0&&IsIconic(native)},
        modern=new{handle=ModernHandle.ToString(),button=Bounds(modernButton),edit=Bounds(modernText),address=Bounds(address),check=Bounds(modernCheck),item=modernList?.ContainerFromIndex(0) is FrameworkElement item?Bounds(item):Bounds(modernList),clicks=modernClicks,opens=modernOpens,text=modernText?.Text,addressText=address?.Text,checkedValue=modernCheck?.IsChecked==true}
    };}
    private static object ListPoint(){GetWindowRect(list,out var r);return new{x=r.left+100.0,y=r.top+38.0,width=320,height=20};}
    private static object MinimizePoint(){GetWindowRect(native,out var r);DwmGetWindowAttribute(native,5,out var c,Marshal.SizeOf<Rect>());return new{x=r.left+c.left+(c.right-c.left)/6.0,y=r.top+(c.top+c.bottom)/2.0};}
    internal static void Close(){if(modern!=null){modern.Close();modern=null;}if(native!=0){DestroyWindow(native);native=0;}button=edit=check=list=0;}
    internal static object Focus(string family){var hwnd=family=="modern"?ModernHandle:native;if(hwnd!=0){ShowWindow(hwnd,9);SetWindowPos(hwnd,(nint)(-1),0,0,0,0,3);SetForegroundWindow(hwnd);}return State();}
    [DllImport("user32.dll")]private static extern bool SetForegroundWindow(nint hwnd);
    internal static object RestoreNative(){if(native!=0)ShowWindow(native,9);return State();}
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]private delegate nint WindowProcedure(nint h,uint m,nint w,nint l);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]private struct WindowClass{public uint size,style;public nint procedure;public int classExtra,windowExtra;public nint instance,icon,cursor,background;public string menuName,className;public nint smallIcon;}
    [StructLayout(LayoutKind.Sequential)]private struct CommonControls{public uint size,classes;}
    [StructLayout(LayoutKind.Sequential)]private struct Rect{public int left,top,right,bottom;}
    [StructLayout(LayoutKind.Sequential)]private struct NativePoint{public int x,y;}
    [StructLayout(LayoutKind.Sequential)]private struct NotifyHeader{public nint hwnd;public nuint id;public int code;}
    [StructLayout(LayoutKind.Sequential)]private struct ListColumn{public uint mask;public int format,width;public nint text;public int maxText,subitem,image,order,minWidth,defaultWidth,idealWidth;}
    [StructLayout(LayoutKind.Sequential)]private struct ListItem{public uint mask;public int item,subitem;public uint state,stateMask;public nint text;public int maxText,image;public nint param;public int indent,group;public uint columns;public nint columnPointer,columnFormat;public int groupIndex;}
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern ushort RegisterClassEx(ref WindowClass cls);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern nint CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int width,int height,nint parent,nint menu,nint instance,nint data);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]private static extern nint GetModuleHandle(string module);
    [DllImport("user32.dll")]private static extern nint LoadCursor(nint instance,nint name);
    [DllImport("comctl32.dll")]private static extern bool InitCommonControlsEx(ref CommonControls controls);
    [DllImport("user32.dll")]private static extern nint DefWindowProc(nint hwnd,uint message,nint w,nint l);
    [DllImport("user32.dll")]private static extern bool DestroyWindow(nint hwnd);
    [DllImport("user32.dll")]private static extern bool GetWindowRect(nint hwnd,out Rect rect);
    [DllImport("user32.dll")]private static extern bool ClientToScreen(nint hwnd,ref NativePoint point);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern int GetWindowText(nint hwnd,StringBuilder text,int length);
    [DllImport("user32.dll")]private static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")]private static extern bool ShowWindow(nint hwnd,int state);
    [DllImport("user32.dll")]private static extern bool SetWindowPos(nint hwnd,nint after,int x,int y,int width,int height,uint flags);
    [DllImport("dwmapi.dll")]private static extern int DwmGetWindowAttribute(nint hwnd,int attribute,out Rect value,int size);
    [DllImport("user32.dll",EntryPoint="SendMessageW")]private static extern nint SendMessage(nint hwnd,uint message,nint w,nint l);
    [DllImport("user32.dll",EntryPoint="SendMessageW")]private static extern nint SendMessageStruct(nint hwnd,uint message,nint w,ref ListColumn value);
    [DllImport("user32.dll",EntryPoint="SendMessageW")]private static extern nint SendMessageStruct(nint hwnd,uint message,nint w,ref ListItem value);
}
