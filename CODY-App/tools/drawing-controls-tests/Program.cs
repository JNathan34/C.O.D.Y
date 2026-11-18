using HeyClicky.App.Cody;
void Check(bool actual,bool expected,string label){if(actual!=expected)throw new Exception(label);Console.WriteLine("PASS: "+label);}
Check(CodyDrawingControlState.HasContent(true,false,0,0,0),false,"an empty canvas never offers Clear, including during narration");
Check(CodyDrawingControlState.HasContent(true,false,3,0,0),false,"computer-control preview/target nodes do not offer Clear without ink");
Check(CodyDrawingControlState.HasContent(true,false,1,0,0),false,"an uninked photo or window does not offer Clear");
Check(CodyDrawingControlState.HasContent(true,false,1,0,1),true,"a rendered 2D drawing offers Clear");
Check(CodyDrawingControlState.HasContent(true,false,0,1,0),true,"a visible 3D model offers Clear");
Check(CodyDrawingControlState.HasContent(false,false,5,1,1),false,"cleared or hidden canvases ignore stale content counts");
Check(CodyDrawingControlState.HasContent(true,true,5,1,1),false,"faded drawings do not leave controls on screen");
Check(CodyDrawingControlState.HasContent(true,false,0,0,0),false,"returning to an empty stream hides old controls");
Check(CodyDrawingControlState.KeepClearDuringStream(true,true,false,true,true,false),true,"an active drawing keeps Clear through one empty composition frame");
Check(CodyDrawingControlState.KeepClearDuringStream(false,true,false,true,true,false),false,"a completed frame does not retain stale controls");
Check(CodyDrawingControlState.KeepClearDuringStream(true,false,false,true,true,false),false,"a hidden canvas removes Clear immediately");
Check(CodyDrawingControlState.KeepClearDuringStream(true,true,true,true,true,false),false,"a faded drawing removes Clear immediately");
Check(CodyDrawingControlState.KeepClearDuringStream(true,true,false,false,true,false),false,"new drawing generation invalidates old Clear controls");
Check(CodyDrawingControlState.KeepClearDuringStream(true,true,false,true,false,false),false,"an actually empty stream does not show Clear");
Check(CodyDrawingControlState.KeepClearDuringStream(true,true,false,true,true,true),false,"a hidden original window does not keep Clear pinned");
foreach(string kind in new[]{"Group","Wrapper","MaskedContainer","Placeholder","Stage3D"})Check(CodyDrawingControlState.IsDrawable(kind),false,kind+" alone does not keep Clear visible");
foreach(string kind in new[]{"Shape","Text","Wash","Dot","Window","Photo"})Check(CodyDrawingControlState.IsDrawable(kind),true,kind+" is real drawing content");
Check(CodyDrawingControlState.IsPressable("RadioButton",false),true,"quiz choices can be recognized by their role");
Check(CodyDrawingControlState.IsPressable("Text",false),false,"static text does not make a ring dismissible");
Check(CodyDrawingControlState.HitDistance(175,75,100,50,150,50)==0,true,"presses anywhere inside a wide outline hit the mark");
Check(CodyDrawingControlState.HitDistance(175,108,100,50,150,50)==64,true,"nearby presses use the distance to the outline edge");
Check(CodyDrawingControlState.HitDistance(90,40,100,50,150,50)==200,true,"corner proximity uses radial distance");

const int width=520,height=360,markX=200,markY=145,markWidth=90,markHeight=80;
byte[] page=Enumerable.Repeat((byte)245,width*height).ToArray();
var noise=new Random(741);
for(int y=markY;y<markY+markHeight;y++)
for(int x=markX;x<markX+markWidth;x++)
    page[y*width+x]=(byte)(noise.Next(36)*5+30);
var anchor=new CodyDrawingAnchor(page,width,height,markX,markY,markWidth,markHeight);
Check(anchor.HasFeatures,true,"a product-like image inside the highlight provides an anchor");
Check(anchor.Locate(Shift(0,-84),0,0,width,height,(0,0),(0,0))==(0,-84),true,"a vertical scroll shifts the drawing with the original content");
Check(anchor.Locate(Shift(32,0),0,0,width,height,(0,0),(0,0))==(32,0),true,"a horizontal scroll shifts the drawing with the original content");
Check(anchor.Locate(Shift(21,-93),21,22,width,height,(0,0),(21,22))==(21,-93),true,"moving the window while scrolling keeps the highlight anchored");
Check(anchor.Locate(Shift(0,-330),0,0,width,height,(0,-84),(0,0))==null,true,"a scrolled-off or replaced target hides the highlight");
Check(anchor.Locate(Shift(0,-84),0,144,width,height,(0,-84),(0,0))==null,true,"a target above the window's visible area stays hidden");
Check(anchor.Locate(page,0,0,width,height,(0,-84),(0,0))==(0,0),true,"returning to the original content restores its drawing");
Check(anchor.Locate(Shift(0,-84),0,0,width,height,(0,0),(0,0),(0,-84))==(0,-84),true,"other marks can suggest scroll motion if this mark confirms it");
Check(anchor.Locate(page,0,0,width,height,(0,0),(0,0),(0,-84))==null,true,"shared motion cannot move a mark onto unrelated content");
Check(new CodyDrawingAnchor(Shift(0,-330),width,height,markX,markY,markWidth,markHeight).HasFeatures,false,"blank areas never act as a scroll anchor");
byte[] repeated=Shift(0,-71),copy=Shift(0,71);
for(int i=0;i<copy.Length;i++)if(copy[i]!=245)repeated[i]=copy[i];
Check(anchor.Locate(repeated,0,0,width,height,(0,0),(0,0))==null,true,"identical targets at two offsets do not relocate the drawing");

byte[] Shift(int horizontal,int vertical)
{
    var image=Enumerable.Repeat((byte)245,width*height).ToArray();
    for(int y=markY;y<markY+markHeight;y++)
    for(int x=markX;x<markX+markWidth;x++)
    {
        int dx=x+horizontal,dy=y+vertical;
        if(dx>=0&&dx<width&&dy>=0&&dy<height)
            image[dy*width+dx]=(byte)Math.Clamp(page[y*width+x]+((x+y)%7)-3,0,255);
    }
    return image;
}
