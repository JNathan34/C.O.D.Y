using System;
using System.Drawing;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Platform.Win32;
namespace HeyClicky.App.Cody;
internal static class CodyAccessibilityInput
{
    internal sealed record Result(bool Handled=false,bool Attempted=false,string Method=null,string Reason=null,string Text=null);
    private static UiaElement lastEdit;
    private static nint lastRoot;
    private static readonly MethodInfo run=typeof(UIAutomationHelpers).GetMethods(BindingFlags.Static|BindingFlags.NonPublic).Single(m=>m.Name=="RunAsync"&&m.IsGenericMethodDefinition).MakeGenericMethod(typeof(Result));
    internal static async Task<Result> Run(Func<Uia,Func<bool>,Result> query,Func<bool> valid){
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(3));bool attempted=false;
        try{
            Func<object,Result> bridge=value=>{
                bool Allowed()=>!timeout.IsCancellationRequested&&valid();
                if(!Allowed())return new(Reason:"Control was stopped.");
                try{return query((Uia)value,()=>{if(!Allowed())throw new OperationCanceledException();attempted=true;return true;});}
                catch(OperationCanceledException){return new(Attempted:attempted,Reason:"Control was stopped.");}
                catch(Exception ex){return new(Attempted:attempted,Reason:"Windows accessibility action failed: "+(ex is COMException?"0x"+ex.HResult.ToString("X8"):ex.GetType().Name));}
            };
            var delegateType=run.GetParameters()[0].ParameterType;var parameter=Expression.Parameter(delegateType.GenericTypeArguments[0]);
            var callback=Expression.Lambda(delegateType,Expression.Invoke(Expression.Constant(bridge),Expression.Convert(parameter,typeof(object))),parameter).Compile();
            var task=(Task<Result>)run.Invoke(null,new object[]{callback,timeout.Token});return await task.WaitAsync(timeout.Token).ConfigureAwait(false)??new Result();
        }catch(OperationCanceledException){return new(Attempted:attempted,Reason:"The app did not answer its accessibility request in time.");}
        catch(Exception){return new(Attempted:attempted,Reason:"Windows accessibility is unavailable for this control.");}
    }
    private static T Pattern<T>(UiaElement element,int id) where T:class {try{return element.GetCurrentPattern(id) as T;}catch{return null;}}
    private static int Int(UiaElement element,int id){try{return Convert.ToInt32(element.GetCurrentPropertyValue(id));}catch{return 0;}}
    private static bool Flag(UiaElement element,int id){try{return element.GetCurrentPropertyValue(id) is bool b&&b;}catch{return false;}}
    private static string Text(UiaElement element,int id){try{return element.GetCurrentPropertyValue(id) as string??"";}catch{return "";}}
    private static bool Contains(UiaElement element,Point point){try{var bounds=element.GetCurrentPropertyValue(30001);if(bounds is double[] a&&a.Length==4)return point.X>=a[0]&&point.Y>=a[1]&&point.X<a[0]+a[2]&&point.Y<a[1]+a[3];}catch{}return false;}
    private static UiaElement At(Uia automation,nint root,Point point){
        var expected=automation.ElementFromHandle(root);UiaElement candidate=null;try{candidate=automation.ElementFromPoint(point);}catch{}
        int ancestors=0;for(var parent=candidate;parent!=null&&ancestors++<128;parent=automation.ControlViewWalker.GetParentElement(parent)){
            if(automation.CompareElements(parent,expected)){if(Int(candidate,30003) is not (50030 or 50032))return candidate;break;}

        }
        // Composition trees can contain overlapping containers. Search every containing
        // branch and prefer a real action over the first full-window drawing pane.
        int budget=400,bestScore=-1;UiaElement best=expected;
        Descend(expected,0,automation.ControlViewWalker);if(bestScore<100)Descend(expected,0,automation.RawViewWalker);return best;
        void Descend(UiaElement current,int depth,UiaWalker walker){
            if(depth>16||budget--<=0)return;
            int type=Int(current,30003);int score=depth+(type==50004||Pattern<UiaInvoke>(current,10000)!=null||Pattern<UiaToggle>(current,10015)!=null||Pattern<UiaSelection>(current,10010)!=null||!string.IsNullOrEmpty(Text(current,30100))?100:0);
            if(score>bestScore){best=current;bestScore=score;}
            for(var child=walker.GetFirstChildElement(current);child!=null&&budget>0;child=walker.GetNextSiblingElement(child))if(Contains(child,point)&&!Flag(child,30022))Descend(child,depth+1,walker);
        }
    }

    internal static Task<Result> TaskbarPoint(nint root,string appName="WhatsApp")=>Run((automation,_)=>{
        var buttons=automation.ElementFromHandle(root).FindAll(4,automation.CreatePropertyCondition(30003,50000));for(int i=0;i<Math.Min(buttons.Length,120);i++){var button=buttons.GetElement(i);if(!string.Equals(CodyTaskbarInput.AppName(Text(button,30005)),appName,StringComparison.OrdinalIgnoreCase)||Flag(button,30022))continue;if(button.GetCurrentPropertyValue(30001) is double[] r&&r.Length==4)return new(true,Text:System.Text.Json.JsonSerializer.Serialize(new{x=r[0]+r[2]/2,y=r[1]+r[3]/2,label=Text(button,30005)}));}return new(Reason:appName+" taskbar button was not exposed.");
    },()=>true);
    internal static Task<Result> Check(nint root,PointD point,bool focusOnly)=>Run((automation,act)=>{
        var element=At(automation,root,new Point((int)point.X,(int)point.Y));int type=Int(element,30003);
        bool focused=false;if(focusOnly&&type==50004){act();element.SetFocus();focused=automation.CompareElements(element,automation.GetFocusedElement());}
        return new(true,focusOnly&&type==50004,"accessibility/diagnostic",Text:System.Text.Json.JsonSerializer.Serialize(new{type,@class=Text(element,30012),invoke=Pattern<UiaInvoke>(element,10000)!=null,legacy=Pattern<UiaLegacy>(element,10018)!=null,defaultAction=Text(element,30100),focused}));
    },()=>true);
    internal static Task<Result> Click(nint root,PointD point,int count,bool control,Func<bool> valid)=>Run((automation,act)=>{
        var location=new Point((int)Math.Round(point.X),(int)Math.Round(point.Y));var leaf=At(automation,root,location);
        int ancestors=0;for(var element=leaf; element!=null&&ancestors++<16;element=automation.ControlViewWalker.GetParentElement(element)){
            int type=Int(element,30003);if(type==50032)break;
            if(element.GetCurrentPropertyValue(30010) is bool enabled&&!enabled)return new(Attempted:true,Reason:"The selected control is disabled.");
            // Taskbar legacy proxies can report success without launching the app.
            if(count==1&&Text(element,30012)=="Taskbar.TaskListButtonAutomationPeer")return new(Method:"shell/taskbar",Text:Text(element,30005));
            if(type==50004&&!Flag(element,30019)){
                act();element.SetFocus();lastEdit=element;lastRoot=root;var text=Pattern<UiaText>(element,10014);
                if(text!=null)try{var range=text.RangeFromPoint(location);if(count>1)range.ExpandToEnclosingUnit(count==2?2:4);act();range.Select();}catch{}
                return new(true,true,"accessibility/focus-field");
            }
            if(type is 50002 or 50000&&Pattern<UiaToggle>(element,10015) is {} toggle){act();toggle.Toggle();return new(true,true,"accessibility/toggle");}
            if(type is 50003 or 50011&&Pattern<UiaExpand>(element,10005) is {} expand){act();if(expand.CurrentExpandCollapseState==1)expand.Collapse();else expand.Expand();return new(true,true,"accessibility/expand");}
            if(type is 50007 or 50019 or 50024&&count==1&&Pattern<UiaSelection>(element,10010) is {} selection){act();if(control)selection.AddToSelection();else selection.Select();return new(true,true,"accessibility/select");}
            if(type is 50000 or 50005 or 50007 or 50011 or 50013 or 50019 or 50024 or 50029 or 50031&&Pattern<UiaInvoke>(element,10000) is {} invoke){act();invoke.Invoke();return new(true,true,"accessibility/invoke");}
            if(type==50013&&Pattern<UiaSelection>(element,10010) is {} radio){act();radio.Select();return new(true,true,"accessibility/select");}
            if((type is 50000 or 50005 or 50007 or 50011 or 50013 or 50019 or 50024 or 50029 or 50031||count==1&&!string.IsNullOrEmpty(Text(element,30100)))&&Pattern<UiaLegacy>(element,10018) is {} legacy){act();legacy.DoDefaultAction();return new(true,true,"accessibility/default-action");}
            if(type is not (50020 or 50026 or 50025 or 50033 or 50029 or 50031))break;
        }
        // Windows 11 taskbar buttons often expose neither Invoke nor a default action.
        if(count==1&&Text(leaf,30012)=="Taskbar.TaskListButtonAutomationPeer")return new(Method:"shell/taskbar",Text:Text(leaf,30005));
        return new();
    },valid);
    internal static Task<Result> OpenStart(Func<bool> valid)=>Run((automation,act)=>{
        var root=automation.GetRootElement();var taskbar=root.FindFirst(2,automation.CreatePropertyCondition(30012,"Shell_TrayWnd"));
        if(taskbar==null)return new(Reason:"The Windows taskbar was not found.");
        var start=taskbar.FindFirst(4,automation.CreatePropertyCondition(30011,"StartButton"));
        if(start==null)return new(Reason:"The Windows Start button was not exposed.");
        if(Pattern<UiaToggle>(start,10015) is {} toggle){act();toggle.Toggle();return new(true,true,"accessibility/start");}
        if(Pattern<UiaInvoke>(start,10000) is {} invoke){act();invoke.Invoke();return new(true,true,"accessibility/start");}
        return new(Reason:"The Windows Start button has no independent action.");
    },valid);
    private static UiaElement Edit(Uia automation,nint root){
        if(lastRoot==root&&lastEdit!=null)try{if(Int(lastEdit,30003)==50004)return lastEdit;}catch{}
        var focused=automation.GetFocusedElement();int ancestors=0;for(var parent=focused;parent!=null&&ancestors++<128;parent=automation.ControlViewWalker.GetParentElement(parent)){if(automation.CompareElements(parent,automation.ElementFromHandle(root)))return focused;}
        return null;
    }
    private static (string Before,string Selected,string After)? Selection(UiaElement element){
        if(Flag(element,30019))return null;var value=Pattern<UiaValue>(element,10002);if(value==null||value.CurrentIsReadOnly)return null;string current=value.CurrentValue??"";
        var text=Pattern<UiaText>(element,10014);if(text==null)return current.Length==0?("","",""):null;
        var ranges=text.GetSelection();if(ranges.Length!=1)return null;var selected=ranges.GetElement(0);var prefix=text.DocumentRange.Clone();prefix.MoveEndpointByRange(1,selected,0);
        var before=prefix.GetText(200001);var middle=selected.GetText(200001);if(before.Length+middle.Length>current.Length||!current.StartsWith(before,StringComparison.Ordinal)||current.Substring(before.Length,middle.Length)!=middle)return null;
        return(before,middle,current[(before.Length+middle.Length)..]);
    }
    internal static Task<Result> Type(nint root,string text,Func<bool> valid)=>Run((automation,act)=>{
        var element=Edit(automation,root);if(element==null)return new();var selection=Selection(element);if(selection==null)return new();var value=Pattern<UiaValue>(element,10002);act();value.SetValue(selection.Value.Before+text+selection.Value.After);
        // Put the caret after the inserted text when the provider supports text ranges.
        try{var pattern=Pattern<UiaText>(element,10014);var range=pattern?.DocumentRange.Clone();if(range!=null){range.MoveEndpointByRange(1,range,0);range.MoveEndpointByUnit(0,0,selection.Value.Before.Length+text.Length);range.MoveEndpointByRange(1,range,0);act();range.Select();}}catch{}
        return new(true,true,"accessibility/type");
    },valid);
    internal static Task<Result> Shortcut(nint root,string chord,Func<bool> valid)=>Run((automation,act)=>{
        if(chord is "ctrl+l" or "control+l" or "f6"){
            var edits=automation.ElementFromHandle(root).FindAll(4,automation.CreatePropertyCondition(30003,50004));
            for(int i=0;i<Math.Min(edits.Length,40);i++){var edit=edits.GetElement(i);var name=(Text(edit,30005)+" "+Text(edit,30011)+" "+Text(edit,30012)).ToLowerInvariant();if(!(name.Contains("address")||name.Contains("urlbar")||name.Contains("omnibox")||name.Contains("search or enter")||name.Contains("search with")&&name.Contains("enter")))continue;
                if(Flag(edit,30022)||!Flag(edit,30010))continue;act();edit.SetFocus();var text=Pattern<UiaText>(edit,10014);if(text!=null){act();text.DocumentRange.Select();}lastEdit=edit;lastRoot=root;return new(true,true,"accessibility/address-bar");
            }return new();
        }
        var field=Edit(automation,root);if(field==null)return new();var pattern=Pattern<UiaText>(field,10014);
        if(chord is "ctrl+a" or "control+a"){if(pattern==null)return new();act();pattern.DocumentRange.Select();return new(true,true,"accessibility/select-all");}
        if(chord is "ctrl+c" or "control+c" or "ctrl+x" or "control+x"){
            var selected=Selection(field);if(selected==null)return new();if(chord.EndsWith("+x")){act();Pattern<UiaValue>(field,10002).SetValue(selected.Value.Before+selected.Value.After);}return new(true,chord.EndsWith("+x"),"accessibility/clipboard",Text:selected.Value.Selected);
        }
        return new();
    },valid);
    internal static void Reset(){_ = Run((_,_)=>{lastEdit=null;lastRoot=0;return new();},()=>true);}
    // COM interface prefixes match the Windows SDK UIAutomationClient.h ABI.
    [ComImport,Guid("30CBE57D-D9D0-452A-AB13-7AC5AC4825EE"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface Uia{
        [return:MarshalAs(UnmanagedType.Bool)]bool CompareElements(UiaElement a,UiaElement b);[return:MarshalAs(UnmanagedType.Bool)]bool CompareRuntimeIds(nint a,nint b);UiaElement GetRootElement();UiaElement ElementFromHandle(nint window);UiaElement ElementFromPoint(Point p);UiaElement GetFocusedElement();UiaElement GetRootElementBuildCache(nint cache);UiaElement ElementFromHandleBuildCache(nint window,nint cache);UiaElement ElementFromPointBuildCache(Point p,nint cache);UiaElement GetFocusedElementBuildCache(nint cache);UiaWalker CreateTreeWalker(nint condition);UiaWalker ControlViewWalker{get;}UiaWalker ContentViewWalker{get;}UiaWalker RawViewWalker{get;}nint RawViewCondition{get;}nint ControlViewCondition{get;}nint ContentViewCondition{get;}nint CreateCacheRequest();[return:MarshalAs(UnmanagedType.Interface)]object CreateTrueCondition();[return:MarshalAs(UnmanagedType.Interface)]object CreateFalseCondition();[return:MarshalAs(UnmanagedType.Interface)]object CreatePropertyCondition(int property,[MarshalAs(UnmanagedType.Struct)]object value);
    }
    [ComImport,Guid("D22108AA-8AC5-49A5-837B-37BBB3D7591E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface UiaElement{
        void SetFocus();nint GetRuntimeId();UiaElement FindFirst(int scope,[MarshalAs(UnmanagedType.Interface)]object condition);UiaArray FindAll(int scope,[MarshalAs(UnmanagedType.Interface)]object condition);nint FindFirstBuildCache(int scope,nint condition,nint cache);nint FindAllBuildCache(int scope,nint condition,nint cache);nint BuildUpdatedCache(nint cache);[return:MarshalAs(UnmanagedType.Struct)]object GetCurrentPropertyValue(int property);[return:MarshalAs(UnmanagedType.Struct)]object GetCurrentPropertyValueEx(int property,int ignore);[return:MarshalAs(UnmanagedType.Struct)]object GetCachedPropertyValue(int property);[return:MarshalAs(UnmanagedType.Struct)]object GetCachedPropertyValueEx(int property,int ignore);void GetCurrentPatternAs(int id,nint iid,nint result);void GetCachedPatternAs(int id,nint iid,nint result);[return:MarshalAs(UnmanagedType.IUnknown)]object GetCurrentPattern(int id);
    }
    [ComImport,Guid("4042C624-389C-4AFC-A630-9DF854A541FC"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface UiaWalker{UiaElement GetParentElement(UiaElement element);UiaElement GetFirstChildElement(UiaElement element);UiaElement GetLastChildElement(UiaElement element);UiaElement GetNextSiblingElement(UiaElement element);}
    [ComImport,Guid("14314595-B4BC-4055-95F2-58F2E42C9855"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface UiaArray{int Length{get;}UiaElement GetElement(int index);}
    [ComImport,Guid("FB377FBE-8EA6-46D5-9C73-6499642D3059"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface UiaInvoke{void Invoke();}
    [ComImport,Guid("94CF8058-9B8D-4AB9-8BFD-4CD0A33C8C70"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface UiaToggle{void Toggle();}
    [ComImport,Guid("A8EFA66A-0FDA-421A-9194-38021F3578EA"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface UiaSelection{void Select();void AddToSelection();void RemoveFromSelection();}
    [ComImport,Guid("619BE086-1F4E-4EE4-BAFA-210128738730"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface UiaExpand{void Expand();void Collapse();int CurrentExpandCollapseState{get;}}
    [ComImport,Guid("828055AD-355B-4435-86D5-3B51C14A9B1B"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface UiaLegacy{void Select(int flags);void DoDefaultAction();}
    [ComImport,Guid("A94CD8B1-0844-4CD6-9D2D-640537AB39E9"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface UiaValue{void SetValue([MarshalAs(UnmanagedType.LPWStr)]string value);string CurrentValue{[return:MarshalAs(UnmanagedType.BStr)]get;}bool CurrentIsReadOnly{[return:MarshalAs(UnmanagedType.Bool)]get;}}
    [ComImport,Guid("32EBA289-3583-42C9-9C59-3B6D9A1E9B6A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface UiaText{UiaRange RangeFromPoint(Point point);UiaRange RangeFromChild(UiaElement element);UiaRanges GetSelection();UiaRanges GetVisibleRanges();UiaRange DocumentRange{get;}}
    [ComImport,Guid("CE4AE76A-E717-4C98-81EA-47371D028EB6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface UiaRanges{int Length{get;}UiaRange GetElement(int index);}
    [ComImport,Guid("A543CC6A-F4AE-494B-8239-C814481187A8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface UiaRange{
        UiaRange Clone();int Compare(UiaRange other);int CompareEndpoints(int endpoint,UiaRange other,int otherEndpoint);void ExpandToEnclosingUnit(int unit);nint FindAttribute(int attribute,[MarshalAs(UnmanagedType.Struct)]object value,int backward);nint FindText([MarshalAs(UnmanagedType.BStr)]string text,int backward,int ignoreCase);[return:MarshalAs(UnmanagedType.Struct)]object GetAttributeValue(int attribute);nint GetBoundingRectangles();UiaElement GetEnclosingElement();[return:MarshalAs(UnmanagedType.BStr)]string GetText(int length);int Move(int unit,int count);int MoveEndpointByUnit(int endpoint,int unit,int count);void MoveEndpointByRange(int endpoint,UiaRange other,int otherEndpoint);void Select();
    }
}
