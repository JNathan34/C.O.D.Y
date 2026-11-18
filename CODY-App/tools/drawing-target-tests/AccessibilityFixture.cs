using System.Drawing;
using HeyClicky;
namespace HeyClicky { internal static class Log { internal static void Warn(string area, string message) {} } }
namespace HeyClicky.App.Cody {

// A retained accessibility tree with a separate desktop overlay hit target.
// The production target code is linked unchanged into this test executable.
internal static class CodyAccessibilityInput
{
 internal record Result(bool Handled=false,bool Attempted=false,string Method=null,string Reason=null,string Text=null,object Data=null);
 internal static Uia Automation;
 internal static Task<Result> Run(Func<Uia,Func<bool>,Result> query,Func<bool> valid,TimeSpan? budget=null)
     => Task.FromResult(valid()?query(Automation,valid):new Result());
 internal class UiaElement(int role, RectD bounds, string name="")
 {
  internal int Role=role;internal RectD Bounds=bounds;internal string Name=name;internal bool Offscreen,Selected;
  internal UiaElement Parent;internal List<UiaElement> Children=[];
  internal UiaElement Add(UiaElement child){child.Parent=this;Children.Add(child);return child;}
  internal object GetCurrentPropertyValue(int property)=>property switch {
   30003=>Role,30001=>new double[]{Bounds.X,Bounds.Y,Bounds.Width,Bounds.Height},30005=>Name,30022=>Offscreen,30079=>Selected,_=>null};
  internal object GetCurrentPattern(int pattern)=>null;
  internal UiaArray FindAll(int scope,object condition){
   var output=new List<UiaElement>();void Visit(UiaElement node){foreach(var child in node.Children){if(condition is int wanted&&child.Role==wanted)output.Add(child);Visit(child);}}
   Visit(this);return new UiaArray(output);
  }
 }
 internal class UiaArray(List<UiaElement> entries){internal int Length=>entries.Count;internal UiaElement GetElement(int index)=>entries[index];}
 internal class UiaWalker
 {
  internal UiaElement GetParentElement(UiaElement node)=>node.Parent;
  internal UiaElement GetFirstChildElement(UiaElement node)=>node.Children.FirstOrDefault();
  internal UiaElement GetNextSiblingElement(UiaElement node){if(node.Parent==null)return null;int index=node.Parent.Children.IndexOf(node)+1;return index<node.Parent.Children.Count?node.Parent.Children[index]:null;}
 }
 internal class Uia(UiaElement root,UiaElement desktopHit)
 {
  internal UiaWalker RawViewWalker=new();
  internal bool CompareElements(UiaElement a,UiaElement b)=>ReferenceEquals(a,b);
  internal UiaElement ElementFromHandle(nint window)=>root;
  internal UiaElement ElementFromPoint(Point point)=>desktopHit;
  internal object CreatePropertyCondition(int property,object value)=>value;
 }
 internal abstract class UiaText { internal abstract UiaRange RangeFromPoint(Point point); }
 internal abstract class UiaRange { internal abstract void ExpandToEnclosingUnit(int unit);internal abstract string GetText(int maximum);internal abstract double[] GetBoundingRectangles(); }
}
}
