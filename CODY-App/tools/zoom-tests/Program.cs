using System;
using HeyClicky.App.Cody;
void Check(bool value,string name){if(!value)throw new Exception(name);Console.WriteLine("PASS "+name);}
Check(CodyZoomMath.Target(6,6,120)<6,"scroll up zooms in");Check(CodyZoomMath.Target(6,6,-120)>6,"scroll down zooms out");
double value=6;for(int i=0;i<100;i++)value=CodyZoomMath.Target(value,6,120);Check(Math.Abs(value-.6)<.0001,"zoom in supports ten times the original magnification");
for(int i=0;i<100;i++)value=CodyZoomMath.Target(value,6,-120);Check(value==24,"zoom out cannot lose the model at infinity");
Check(Math.Abs(CodyZoomMath.Target(CodyZoomMath.Target(6,6,120),6,-120)-6)<.0001,"opposite scroll steps are symmetric");
Check(Math.Abs(CodyZoomMath.Target(6,6,1)-6)<.01,"high-resolution wheel input does not jump");
double current=6;bool monotonic=true;for(int i=0;i<100;i++){double next=CodyZoomMath.Ease(current,3,1/120d);monotonic&=next<=current&&next>=3;current=next;}Check(monotonic,"zoom eases without overshooting");
Check(Math.Abs(current-3)<.001,"smooth zoom reaches its target");
