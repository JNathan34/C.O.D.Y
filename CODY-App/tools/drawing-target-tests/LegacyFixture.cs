using HeyClicky;
using HeyClicky.App.Cody;
using System.Runtime.InteropServices;
internal sealed class LegacyFixture(int role, RectD bounds, string name="", string url="") : CodyDrawingLegacyTarget.Accessible, CodyDrawingLegacyTarget.AccIdentity
{
 private static int serial;
 private readonly int identity=++serial;
 private LegacyFixture source;
 private LegacyFixture Source=>source??this;
 internal static bool FreshWrappers;
 internal bool CoarseHit,ChildIdHit;
 internal int IdentityEpoch;
 internal LegacyFixture Proxy()=>new(Role,Bounds,Name,Url){source=Source};
 internal int Role=role;internal RectD Bounds=bounds;internal string Name=name,Url=url;internal bool Hidden,Selected;
 internal LegacyFixture Parent;internal List<LegacyFixture> Children=[];
 internal LegacyFixture Add(LegacyFixture child){child.Parent=this;Children.Add(child);return child;}
 public object accParent=>FreshWrappers?Source.Parent?.Proxy():Source.Parent;
 public int accChildCount=>Source.Children.Count;
 public object get_accChild(object child){int id=Convert.ToInt32(child);var result=id<0?Source.Children.Single(c=>c.identity==-id):Source.Children[id-1];return FreshWrappers?result.Proxy():result;}
 public string get_accName(object child)=>Source.Name;
 public string get_accValue(object child)=>Source.Url;
 public object get_accRole(object child)=>Source.Role;
 public object get_accState(object child)=>(Source.Hidden?0x10000:0)|(Source.Selected?2:0);
 public void accLocation(out int x,out int y,out int width,out int height,object child){var r=Source.Bounds;x=(int)r.X;y=(int)r.Y;width=(int)r.Width;height=(int)r.Height;}
 public object accHitTest(int x,int y){if(!Source.CoarseHit)foreach(var child in Source.Children)if(!child.Hidden&&child.Bounds.Contains(new PointD(x,y)))return Source.ChildIdHit?-child.identity:child.accHitTest(x,y);return FreshWrappers?Source.Proxy():Source;}
 public void GetIdentityString(uint child,out nint data,out uint length){var bytes=BitConverter.GetBytes(Source.identity).Concat(BitConverter.GetBytes(Source.IdentityEpoch)).Concat(BitConverter.GetBytes(child)).ToArray();length=(uint)bytes.Length;data=Marshal.AllocCoTaskMem(bytes.Length);Marshal.Copy(bytes,0,data,bytes.Length);}
 public string get_accDescription(object child)=>"";
 public string get_accHelp(object child)=>"";
 public int get_accHelpTopic(out string file,object child){file="";return 0;}
 public string get_accKeyboardShortcut(object child)=>"";
 public object accFocus=>null;
 public object accSelection=>null;
 public string get_accDefaultAction(object child)=>"";
 public void accSelect(int flags,object child)=>throw new NotSupportedException();
 public object accNavigate(int direction,object child)=>throw new NotSupportedException();
 public void accDoDefaultAction(object child)=>throw new NotSupportedException();
 public void put_accName(object child,string name)=>throw new NotSupportedException();
 public void put_accValue(object child,string value)=>throw new NotSupportedException();
}
