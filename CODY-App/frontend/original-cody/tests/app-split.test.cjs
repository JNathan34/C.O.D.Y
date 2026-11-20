'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseAppCommand}=require('../src/app-commands');
const {splitApps,manageWindow,validateSplitApps}=require('../src/control/app-layout');
const {runPowerShell}=require('../src/control/windows');
const {ComputerController}=require('../src/control/controller');
const {IslandUtilities}=require('../src/island-utilities');
test('short app names and the reported Spotify dictation use concise local opening acknowledgements',async()=>{
  const actions=[],utilities=new IslandUtilities({controller:{execute:async(action,args)=>{actions.push({action,args});return {ok:true};}},showCard(){}});
  for(const text of ['Spotify.','Open spot of','Open Spotify','could you open Spotify please']){
    const result=await utilities.run(text);assert.equal(result.reply,'Opening Spotify.');assert.equal(result.confirmation,'Opening Spotify.');assert.deepEqual(actions.at(-1),{action:'app.open',args:{app:'spotify'}});
  }
  assert.equal((await utilities.run('open Firefox')).confirmation,'Opening Firefox.');
});
test('natural split-screen requests retain app order and map Plex to Plezy',()=>{
  for(const text of ['open Firefox and Plezy in split screen','Could you open Firefox and Plex side by side please?','launch Mozilla Firefox with the Plezy app in a split-screen','split screen with Firefox and Plezy','put Firefox and Plezy next to each other'])assert.deepEqual(parseAppCommand(text),{action:'app.split',args:{apps:['firefox','plezy']}},text);
  assert.deepEqual(parseAppCommand('open Plezy and Firefox in split screen').args.apps,['plezy','firefox']);
  for(const text of ['open Firefox and Plezy in split screen and send an email','open Firefox and delete files in split screen','open Firefox and Firefox in split screen','open Firefox, Plezy, Chrome, Word and Notepad in split screen','explain split screen','play Iron Man on Plezy'])assert.equal(parseAppCommand(text),null,text);
});
test('window commands preserve titles, placement and explicit new-window intent',()=>{
  assert.deepEqual(parseAppCommand('Put Word "Budget" on the right and Firefox on the left at 60/40'),{action:'app.split',args:{apps:['firefox','word'],titles:[null,'Budget'],ratio:0.6}});
  assert.deepEqual(parseAppCommand('Open Discord and split the screen with my browser'),{action:'app.split',args:{apps:['discord','browser']}});
  assert.deepEqual(parseAppCommand('Move Word "Budget" to my second monitor'),{action:'window.manage',args:{app:'word',title:'Budget',operation:'move',display:2}});
  assert.deepEqual(parseAppCommand('Is Notepad already open? Bring it to the front.'),{action:'window.manage',args:{app:'notepad',operation:'focus'}});
  assert.deepEqual(parseAppCommand('Open a new document in Word'),{action:'app.open',args:{app:'word',newWindow:true}});
});
test('ordinary focus requests target existing windows, including apps outside the launch list',()=>{
  for(const text of ['Switch to Word','Bring Word to the foreground','Change the app focus to Microsoft Word','Go back to Word'])
    assert.deepEqual(parseAppCommand(text),{action:'window.manage',args:{app:'word',operation:'focus'}},text);
  assert.deepEqual(parseAppCommand('Switch to Visual Studio Code'),{action:'window.manage',args:{windowName:'Visual Studio Code',operation:'focus'}});
  assert.deepEqual(parseAppCommand('Activate “Budget - Excel”'),{action:'window.manage',args:{windowName:'Budget - Excel',operation:'focus'}});
  assert.deepEqual(parseAppCommand('List open windows'),{action:'window.list',args:{}});
  assert.deepEqual(parseAppCommand('Change app focus'),{action:'window-choose',args:{}});
  for(const text of ['Is the door open?','Go to Google','Switch to dark mode','Focus Word and send an email'])
    assert.equal(parseAppCommand(text),null,text);
});
test('unsupported and repeated apps cannot reach the Windows layout runner',async()=>{
  let ran=false;for(const apps of [['firefox','unknown'],['plex','plezy'],['firefox'],['firefox','plezy','chrome','word','notepad'],['firefox',"plezy';Remove-Item"]])await assert.rejects(splitApps(apps,{runner:()=>{ran=true;}}));assert.equal(ran,false);
  assert.deepEqual(validateSplitApps(['Mozilla Firefox','Plex']),['firefox','plezy']);
});
test('split runner requires confirmed ordered windows before reporting success',async()=>{
  const result={arranged:true,windows:[{app:'firefox'},{app:'plezy'}]};
  assert.deepEqual(await splitApps(['firefox','plezy'],{runner:async()=>JSON.stringify(result)}),result);
  for(const invalid of [{arranged:false,windows:result.windows},{arranged:true,windows:[]},{arranged:true,windows:[{app:'plezy'},{app:'firefox'}]},{arranged:true,windows:[null,{app:'plezy'}]}])await assert.rejects(splitApps(['firefox','plezy'],{runner:async()=>JSON.stringify(invalid)}),/confirm/);
  await assert.rejects(splitApps(['firefox','plezy'],{runner:async()=>'{'}),/readable split-screen result/);
});
test('the Windows helper returns one JSON result after focusing the left window',{skip:process.platform!=='win32'},async()=>{
  // Run the real PowerShell split flow with in-memory windows so the test
  // cannot move any windows on the desktop.
  const fixture=String.raw`
class CodyAppLayout {
  static [void] UsePhysicalPixels() {}
  static [hashtable] WorkArea() { return @{Left=0;Top=0;Width=1600;Height=900} }
  static [hashtable[]] FindAll([string[]]$names,[bool]$explorer) {
    if($names.Length -eq 0){
      return @(@{Pid=2;Title='Project - Visual Studio Code';Process='Code'},@{Pid=3;Title='Budget - Excel';Process='EXCEL'},@{Pid=3;Title='Notes - Excel';Process='EXCEL'})
    }
    if($names[0] -eq 'WINWORD'){
      return @(@{Pid=1;Title='Budget - Word';Bounds=$null},@{Pid=1;Title='Notes - Word';Bounds=$null})
    }
    return @(@{Pid=1;Title=$names[0];Bounds=$null})
  }
  static [bool] Foreground([hashtable]$window) { return $false }
  static [bool] Minimized([hashtable]$window) { return $false }
  static [void] Restore([hashtable]$window) {}
  static [void] Place([hashtable]$window,[int]$left,[int]$top,[int]$width,[int]$height) {
    $window.Bounds=@{Left=$left;Top=$top;Width=$width;Height=$height}
  }
  static [bool] Fits([hashtable]$window,[int]$left,[int]$top,[int]$width,[int]$height) {
    return $window.Bounds.Left -eq $left -and $window.Bounds.Top -eq $top -and $window.Bounds.Width -eq $width -and $window.Bounds.Height -eq $height
  }
  static [bool] Focus([hashtable]$window) { return $true }
  static [hashtable] Visible([hashtable]$window) { return $window.Bounds }
  static [void] Rollback([hashtable]$window) {}
}
function Add-Type { param([string]$TypeDefinition) }
`;
  const result=await splitApps(['file explorer','firefox'],{
    runner:(command,options)=>runPowerShell(fixture+command,options),
  });
  assert.deepEqual(result.windows.map(({app,side})=>({app,side})),[
    {app:'file explorer',side:'left'},{app:'firefox',side:'right'},
  ]);
  const runner=(command,options)=>runPowerShell(fixture+command,options);
  await assert.rejects(splitApps(['firefox','word'],{runner}),/Which word window.*Budget - Word.*Notes - Word/);
  const named=await splitApps(['firefox','word'],{runner,titles:[null,'Notes'],ratio:0.6});
  assert.equal(named.windows[1].title,'Notes - Word');
  assert.equal(named.windows[0].bounds.width,960);
  const grid=await splitApps(['firefox','word','notepad','file explorer'],{runner,titles:[null,'Budget',null,null]});
  assert.deepEqual(grid.windows[3].bounds,{x:800,y:450,width:800,height:450});
  const three=await splitApps(['firefox','word','notepad'],{runner,titles:[null,'Budget',null]});
  assert.deepEqual(three.windows[2].bounds,{x:0,y:450,width:1600,height:450});
  const code=await manageWindow({windowName:'Visual Studio Code',operation:'focus'},{runner});
  assert.equal(code.title,'Project - Visual Studio Code');
  const budget=await manageWindow({windowName:'Budget - Excel',operation:'focus'},{runner});
  assert.equal(budget.title,'Budget - Excel');
  await assert.rejects(manageWindow({windowName:'Excel',operation:'focus'},{runner}),/Several windows.*Budget - Excel.*Notes - Excel/);
  await assert.rejects(manageWindow({windowName:'Missing Window',operation:'focus'},{runner}),/no open window/);
});
test('both app and window permissions apply, and a denied split cannot launch apps',async()=>{
  let ran=false;const runner=async()=>{ran=true;return '{}';};
  const disabled=new ComputerController({readPermissions:()=>({enabled:true,level:'approve-safe',applications:true,windows:false}),runner});
  await assert.rejects(disabled.execute('app.split',{apps:['firefox','plezy']},{origin:'chat'}),/windows/);assert.equal(ran,false);
  await assert.rejects(disabled.execute('window.manage',{windowName:'Visual Studio Code',operation:'focus'},{origin:'chat'}),/windows/);assert.equal(ran,false);
  const denied=new ComputerController({readPermissions:()=>({enabled:true,level:'ask',applications:true,windows:true}),confirm:async()=>false,runner});
  assert.equal((await denied.execute('app.split',{apps:['firefox','plezy']},{origin:'chat'})).cancelled,true);assert.equal(ran,false);
});
test('split request collapses the chat and shows the Island card only after success',async()=>{
  const cards=[],actions=[];let collapsed=false;
  const utilities=new IslandUtilities({controller:{execute:async(action,args)=>{actions.push({action,args});return {ok:true};}},showCompact:()=>collapsed=true,showCard:card=>cards.push(card)});
  const result=await utilities.run('open Firefox and Plex in split screen');assert.equal(result.handled,true);assert.equal(collapsed,true);assert.deepEqual(actions,[{action:'app.split',args:{apps:['firefox','plezy']}}]);assert.equal(cards[0].text,'Split screen');assert.match(result.reply,/Firefox on the left.*Plezy on the right/);
  collapsed=false;cards.length=0;utilities.controller.execute=async()=>({ok:false,error:'Plezy did not open'});const failed=await utilities.run('open Firefox and Plezy in split screen');assert.equal(failed.error,true);assert.equal(collapsed,false);assert.equal(cards[0].text,'Unavailable');
});
