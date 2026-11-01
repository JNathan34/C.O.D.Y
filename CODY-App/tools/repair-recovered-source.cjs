'use strict';
// Repair source reconstruction artifacts only. Runtime engine DLLs stay original.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../work/Cody.Engine/HeyClicky/App');
function edit(relative,change){const file=path.join(root,relative),before=fs.readFileSync(file,'utf8'),after=change(before);assert.notEqual(after,before,'No repair applied to '+relative);fs.writeFileSync(file,after);}
function replace(source,from,to){assert.ok(source.includes(from),'Expected original expression: '+from.slice(0,80));return source.replace(from,to);}
// Find a C# statement end while ignoring nested lambda bodies and literals.
function statementEnd(source,start){let depth=0,quote=null,verbatim=false;for(let i=start;i<source.length;i++){const ch=source[i];if(quote){if(verbatim&&ch==='"'&&source[i+1]==='"'){i++;continue;}if(!verbatim&&ch==='\\'){i++;continue;}if(ch===quote)quote=null;continue;}if(ch==='"'||ch==="'"){quote=ch;verbatim=ch==='"'&&source[i-1]==='@';continue;}if(ch==='/'&&source[i+1]==='/'){i=source.indexOf('\n',i);if(i<0)break;continue;}if(ch==='/'&&source[i+1]==='*'){i=source.indexOf('*/',i+2)+1;continue;}if('([{'.includes(ch))depth++;if(')]}'.includes(ch))depth--;if(ch===';'&&depth===0)return i+1;}throw Error('No statement end');}
edit('Dock/ArcCardContent.cs',s=>s.replace(/(public (?:bool|string\?|CardFooterRequest\?|CardReadyOutput\?|ClickyLiveLine\?|ClickyAnswer\?) (?:TaskIsRunning|Request|ReadyOutput|LiveLine|Answer|IsFinalizing|NotePath) \{ get; )init;/g,'$1set;'));
edit('Wiring/RealStack.cs',source=>{
 const start=source.indexOf('CompanionSessionOptions companionSessionOptions = new CompanionSessionOptions');assert.ok(start>=0);const initialEnd=statementEnd(source,start),end=source.indexOf('CompanionSession companion =',initialEnd);assert.ok(end>initialEnd);
 const tail=source.slice(initialEnd,end),silence=/string silence = TestSpeakerSilence\(\);/.exec(tail);assert.ok(silence);
 const properties=[];const expression=/companionSessionOptions\.([A-Za-z0-9_]+)\s*=/g;let match;
 while((match=expression.exec(tail))){const finish=statementEnd(tail,match.index);properties.push(match[1]+' = '+tail.slice(expression.lastIndex,finish-1).trim());expression.lastIndex=finish;}
 assert.equal(properties.length,20);let initial=source.slice(start,initialEnd).trimEnd();assert.ok(initial.endsWith('};'));initial=initial.slice(0,-2).trimEnd();if(!initial.endsWith(','))initial+=',';
 const rebuilt=silence[0]+'\n\t\t'+initial+'\n\t\t\t'+properties.join(',\n\t\t\t')+'\n\t\t};\n\t\t';return source.slice(0,start)+rebuilt+source.slice(end);
});
edit('Demo/ScreenGrab.cs',s=>'using System;\n'+s);
edit('OneBrain/ClickyTourJob.cs',source=>{const start=source.indexOf('\t\t\tstring? Str(string key)'),body=source.indexOf('{',start);assert.ok(start>=0);let depth=1,end=body+1;while(depth){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}const local=source.slice(start,end);source=source.slice(0,start)+source.slice(end);return replace(source,'\t\tJsonObject o;','\t\tJsonObject o;\n'+local.replace(/^\t/mg,''));});
edit('Proactive/ProactiveCoordinator.cs',source=>{
 source=replace(source,'proactiveRequestInputs2.ReadsForMorningPaper = flag && GoodMorningBrief.IsMorningPaperEnabled(real.Core.Settings);','proactiveRequestInputs = proactiveRequestInputs with { ReadsForMorningPaper = flag && GoodMorningBrief.IsMorningPaperEnabled(real.Core.Settings) };');
 source=replace(source,'proactiveRequestInputs.ExistingRoutines = routines.Select((ClickyRoutine r) => (Title: r.Title, IntervalMinutes: r.IntervalMinutes)).ToList();','proactiveRequestInputs = proactiveRequestInputs with { ExistingRoutines = routines.Select((ClickyRoutine r) => (Title: r.Title, IntervalMinutes: r.IntervalMinutes)).ToList() };');
 return replace(source,'proactiveSuggestionCard.Routine = ((routineEveryMinutes.HasValue && routineEveryMinutes.GetValueOrDefault() > 0) ? new ProactiveRoutine(s.RoutineEveryMinutes.Value, s.RoutineTitle ?? s.Title) : null);','proactiveSuggestionCard = proactiveSuggestionCard with { Routine = ((routineEveryMinutes.HasValue && routineEveryMinutes.GetValueOrDefault() > 0) ? new ProactiveRoutine(s.RoutineEveryMinutes.Value, s.RoutineTitle ?? s.Title) : null) };');
});
edit('Ink/InkTextView.cs',s=>replace(s,'value.Right = Math.Max(list[list.Count - 1].Right, item.Right);','value = value with { Right = Math.Max(list[list.Count - 1].Right, item.Right) };'));
edit('AppHost.cs',source=>source.replace(/chatTaskEnd\.(CompletedAssistantMessages|UserFacingArtifactPaths|SuggestedNextActions|FinalAnswer|IsScheduledRoutineRun|CompletedThreadName) = ([^;]+);/g,'chatTaskEnd = chatTaskEnd with { $1 = $2 };'));
edit('Settings/SettingsContent.cs',s=>replace(s,'customConnector.TokenFromSignIn = (object)existing2 != null && existing2.TokenFromSignIn && connectorDraft.Auth == "browser";','customConnector = customConnector with { TokenFromSignIn = (object)existing2 != null && existing2.TokenFromSignIn && connectorDraft.Auth == "browser" };'));
edit('Ink/ClickyInkPagination.cs',s=>replace(s,'clickyInkGroup2.Blocks = list4;','clickyInkGroup2 = clickyInkGroup2 with { Blocks = list4 };'));
edit('Ink/ClickyInkPageView.cs',s=>replace(s,'clickyInkGroup.Blocks = list3;','clickyInkGroup = clickyInkGroup with { Blocks = list3 };'));
edit('Ink/ClickyInkSheetView.cs',source=>{
 source=replace(source,'row5.CollapsedBelow = new _003C_003Ez__ReadOnlyArray<string>(array);','row4 = row4 with { CollapsedBelow = new _003C_003Ez__ReadOnlyArray<string>(array) };');
 source=replace(source,'row3.Info = row4;','row2 = row2 with { Info = row4 };');
 source=replace(source,'row10.CollapsedAbove = new _003C_003Ez__ReadOnlyArray<string>(array2);','row9 = row9 with { CollapsedAbove = new _003C_003Ez__ReadOnlyArray<string>(array2) };');
 return replace(source,'row8.Info = row9;','row7 = row7 with { Info = row9 };');
});
console.log('Repaired 12 recovered frontend source files; backend DLLs were not edited.');

