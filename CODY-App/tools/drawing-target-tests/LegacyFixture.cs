using HeyClicky;
using HeyClicky.App.Cody;
internal sealed class LegacyFixture(int role, RectD bounds, string name="", string url="") : CodyDrawingLegacyTarget.Accessible
{
 internal int Role=role;internal RectD Bounds=bounds;internal string Name=name,Url=url;internal bool Hidden,Selected;
 internal LegacyFixture Parent;internal List<LegacyFixture> Children=[];
 internal LegacyFixture Add(LegacyFixture child){child.Parent=this;Children.Add(child);return child;}
 public object accParent=>Parent;
 public int accChildCount=>Children.Count;
 public object get_accChild(object child)=>Children[Convert.ToInt32(child)-1];
 public string get_accName(object child)=>Name;
 public string get_accValue(object child)=>Url;
 public object get_accRole(object child)=>Role;
 public object get_accState(object child)=>(Hidden?0x10000:0)|(Selected?2:0);
 public void accLocation(out int x,out int y,out int width,out int height,object child){x=(int)Bounds.X;y=(int)Bounds.Y;width=(int)Bounds.Width;height=(int)Bounds.Height;}
 public object accHitTest(int x,int y){foreach(var child in Children)if(!child.Hidden&&child.Bounds.Contains(new PointD(x,y)))return child.accHitTest(x,y) is LegacyFixture deeper?deeper:child;return this;}
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
