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
foreach(string kind in new[]{"Group","Wrapper","MaskedContainer","Placeholder","Stage3D"})Check(CodyDrawingControlState.IsDrawable(kind),false,kind+" alone does not keep Clear visible");
foreach(string kind in new[]{"Shape","Text","Wash","Dot","Window","Photo"})Check(CodyDrawingControlState.IsDrawable(kind),true,kind+" is real drawing content");

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
