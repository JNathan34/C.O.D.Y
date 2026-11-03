using HeyClicky.App.Cody;
void Check(bool actual,bool expected,string label){if(actual!=expected)throw new Exception(label);Console.WriteLine("PASS: "+label);}
Check(CodyDrawingControlState.HasContent(true,false,0,0),false,"an empty canvas never offers Clear, including during narration");
Check(CodyDrawingControlState.HasContent(true,false,1,0),true,"a rendered 2D drawing offers Clear");
Check(CodyDrawingControlState.HasContent(true,false,0,1),true,"a visible 3D model offers Clear");
Check(CodyDrawingControlState.HasContent(false,false,5,1),false,"cleared or hidden canvases ignore stale content counts");
Check(CodyDrawingControlState.HasContent(true,true,5,1),false,"faded drawings do not leave controls on screen");
Check(CodyDrawingControlState.HasContent(true,false,0,0),false,"returning to an empty stream hides old controls");
foreach(string kind in new[]{"Group","Wrapper","MaskedContainer","Placeholder","Stage3D"})Check(CodyDrawingControlState.IsDrawable(kind),false,kind+" alone does not keep Clear visible");
foreach(string kind in new[]{"Shape","Text","Wash","Dot","Window","Photo"})Check(CodyDrawingControlState.IsDrawable(kind),true,kind+" is real drawing content");
