using System.Diagnostics;
using HeyClicky.App.Cody;
int checks=0;
void Check(bool value,string name){if(!value)throw new Exception(name);checks++;Console.WriteLine("PASS "+name);}
var watch=Stopwatch.StartNew();
await CodyControlSpeed.WaitForScreenAsync(_=>Task.FromResult<byte[]?>([0]),(a,b)=>0,default);
Check(watch.ElapsedMilliseconds is >=140 and <700,$"unchanged screen settles in {watch.ElapsedMilliseconds} ms");
int count=0;
watch.Restart();
await CodyControlSpeed.WaitForScreenAsync(_=>Task.FromResult<byte[]?>([(byte)count++]),(a,b)=>1,default);
Check(watch.ElapsedMilliseconds is >=700 and <1500,$"animated screen bounded at {watch.ElapsedMilliseconds} ms");
watch.Restart();
await CodyControlSpeed.WaitForScreenAsync(_=>Task.FromResult<byte[]?>(null),(a,b)=>0,default);
Check(watch.ElapsedMilliseconds<500,"missing sample uses short fallback");
watch.Restart();
await CodyControlSpeed.WaitForScreenAsync(_=>new TaskCompletionSource<byte[]?>().Task,(a,b)=>0,default);
Check(watch.ElapsedMilliseconds<1500,"stalled capture cannot hang settling");
using(var cancel=new CancellationTokenSource(40)){
watch.Restart();bool cancelled=false;
try{await CodyControlSpeed.WaitForScreenAsync(_=>new TaskCompletionSource<byte[]?>().Task,(a,b)=>0,cancel.Token);}catch(OperationCanceledException){cancelled=true;}
Check(cancelled&&watch.ElapsedMilliseconds<400,"Esc token interrupts stalled capture");}
count=0;
await CodyControlSpeed.WaitForScreenAsync(_=>Task.FromResult<byte[]?>([(byte)count++]),(a,b)=>b[0]<3?1:0,default);
Check(count==5,"changing screen requires two consecutive calm samples");
Check(CodyControlSpeed.GlideSeconds(3000,.45)==.18,"long cursor travel stays visible but caps at 180 ms");
Check(CodyControlSpeed.GlideSeconds(10,.45)==.08,"short cursor travel glides over 80 ms");
Check(CodyControlSpeed.GlideSeconds(3000,.02)==.08,"short requested glides still have enough time to animate");
Check(CodyControlSpeed.ActionPause("click")==20,"click pause reduced to 20 ms");
Check(CodyControlSpeed.ActionPause("wait")==0,"explicit waits do not get an extra pause");
Console.WriteLine($"{checks} checks passed");
