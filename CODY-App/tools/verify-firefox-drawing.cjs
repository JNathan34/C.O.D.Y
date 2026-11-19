'use strict';

// Run against a separate Firefox profile and a page served by this fixture.
const {app,screen,desktopCapturer}=require('electron');
const {spawn,execFileSync}=require('node:child_process');
const {once}=require('node:events');
const {createServer}=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {NativeEngine}=require('../frontend/original-cody/src/native-engine');

const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cody-firefox-drawing-'));
app.setPath('userData',profile);
app.on('window-all-closed',()=>{});
const browserProfile=path.join(profile,'firefox');
fs.mkdirSync(browserProfile);
fs.writeFileSync(path.join(browserProfile,'user.js'),[
 'user_pref("browser.aboutwelcome.enabled", false);',
 'user_pref("browser.shell.checkDefaultBrowser", false);',
 'user_pref("browser.startup.homepage_override.mstone", "ignore");',
].join('\n'));

const title='CODY Firefox drawing fixture '+process.pid;
let report,action={id:0},browser,engine;
const server=createServer((request,response)=>{
 if(request.url.startsWith('/report?')){
  report=JSON.parse(new URL(request.url,'http://127.0.0.1').searchParams.get('state'));
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify(action));return;
 }
 const second=request.url==='/second';
 response.setHeader('Content-Type','text/html; charset=utf-8');
 response.end(`<!doctype html><title>${title}${request.url==='/different-title'?' (new page)':''}</title>
 <body style="margin:0;height:1800px;background:white">
 <h1 style="margin:32px">${second?'Different document':'Firefox drawing test'}</h1>
 <button id="focus-target" autofocus style="margin-left:32px">Fixture focus</button>
 <svg xmlns="http://www.w3.org/2000/svg" id="speaker" role="img" aria-label="Test speaker" viewBox="0 0 180 100" style="position:absolute;left:140px;top:280px;width:180px;height:100px"><rect fill="#333" x="5" y="5" width="170" height="90" rx="8"/></svg>
 <script>
 let previous=0;
 setInterval(async()=>{
  const box=document.querySelector('#speaker').getBoundingClientRect();
  const state={x:mozInnerScreenX+box.x,y:mozInnerScreenY+box.y,width:box.width,height:box.height,scroll:scrollY,page:location.pathname,title:document.title};
  const next=await (await fetch('/report?state='+encodeURIComponent(JSON.stringify(state)),{cache:'no-store'})).json();
  if(next.id===previous)return;
  previous=next.id;
  if(next.scroll!==undefined)scrollTo(0,next.scroll);
  if(next.navigate&&location.pathname!==next.navigate)location.href=next.navigate;
 },80);
 </script>`);
});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(label,read,predicate,timeout=12000){
 let value;
 for(const deadline=Date.now()+timeout; Date.now()<deadline;){
  value=await read();
  if(predicate(value)){console.log('PASS: '+label);return value;}
  await wait(100);
 }
 throw Error(label+': '+JSON.stringify(value));
}
const state=()=>engine.request('drawing-controls-state');

app.whenReady().then(async()=>{
 try{
  const executable=process.env.CODY_FIREFOX_BINARY || execFileSync('powershell.exe',['-NoProfile','-Command',
   '(Get-Process firefox -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1).Path'],{encoding:'utf8',windowsHide:true}).trim();
  if(!executable)throw Error('Set CODY_FIREFOX_BINARY to the Firefox executable.');
  server.listen(0,'127.0.0.1');await once(server,'listening');
  engine=new NativeEngine();await engine.refresh();
  browser=spawn(executable,['-no-remote','-profile',browserProfile,
   `http://127.0.0.1:${server.address().port}/first`],{windowsHide:false,stdio:'ignore'});
  let failure;browser.on('error',error=>{failure=error;});
  const original=await until('isolated Firefox rendered the local test page',()=>{
   if(failure)throw failure;return report;
  },value=>value?.page==='/first',25000);
  await wait(250);
  const primary=screen.getPrimaryDisplay(),scale=primary.scaleFactor;
  const monitor=screen.dipToScreenPoint(primary.bounds);
  const {x,y}=screen.dipToScreenPoint({x:Math.round(original.x),y:Math.round(original.y)});
  const area={width:Math.round(primary.bounds.width*scale),height:Math.round(primary.bounds.height*scale)};
  const box={x:x-monitor.x,y:y-monitor.y,width:original.width*scale,height:original.height*scale};
  await engine.request('drawing-controls-test-highlight',{windowTitlePrefix:title,marks:[{
   x:box.x/area.width,y:box.y/area.height,width:box.width/area.width,height:box.height/area.height,
  }]});
  await until('Firefox displays the ring and Clear control',state,value=>
   value.follow?.ownerForeground&&value.follow.marks.some(mark=>mark.visible)&&value.clearVisible);
  await wait(1600);
  const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:area});
  const image=sources.find(source=>source.display_id===String(primary.id)).thumbnail,pixels=image.toBitmap();
  const size=image.getSize();let ink=0;
  for(let row=Math.max(0,box.y-16);row<Math.min(size.height,box.y+box.height+16);row++)
   for(let col=Math.max(0,box.x-16);col<Math.min(size.width,box.x+box.width+16);col++){
    const i=(row*size.width+col)*4,b=pixels[i],g=pixels[i+1],r=pixels[i+2];
    if(b>150&&g>75&&b>r*1.35&&b>g*1.05)ink++;
   }
  assert.ok(ink>200,`Firefox ink must remain on the desktop after animation, found ${ink} pixels`);
  console.log(`PASS: finished ink is visible over Firefox (${ink} pixels)`);
  const bound=(await state()).follow.marks[0].anchored;
  if(process.argv.includes('--require-anchor'))assert.ok(bound,'Firefox did not expose a trackable page element');
  action={id:1,scroll:120};
  await until('Firefox scrolled the test page',()=>report,value=>value?.scroll===120);
  if(bound){
   await until('the same ring follows Firefox content on scroll',state,value=>
    value.follow?.marks.some(mark=>mark.visible&&mark.anchored&&Math.abs(mark.y+120*scale)<6));
   action={id:2,navigate:'/second'};
   await until('same-title Firefox navigation hides the previous drawing',state,value=>
    report.page==='/second'&&value.follow?.marks.every(mark=>!mark.visible)&&!value.clearVisible);
  }else{
   console.log('Firefox did not expose a trackable page element. Checking the stationary drawing fallback.');
   await engine.request('drawing-controls-test-screen-change',{reason:'scroll'});
   await until('scroll hides the old Firefox screenshot position',state,value=>
    value.follow?.marks.every(mark=>!mark.visible)&&!value.clearVisible);
   await engine.request('clear');
   await until('Clear removes the Firefox drawing',state,value=>!value.showing);
   await engine.request('drawing-controls-test-highlight',{windowTitlePrefix:title,marks:[{
    x:box.x/area.width,y:(box.y-120*scale)/area.height,width:box.width/area.width,height:box.height/area.height,
   }]});
   await until('a fresh drawing appears after Firefox scrolls',state,value=>value.follow?.marks.some(mark=>mark.visible));
   action={id:2,navigate:'/different-title'};
   await until('Firefox page change hides the stationary drawing',state,value=>
    report.page==='/different-title'&&value.follow?.marks.every(mark=>!mark.visible)&&!value.clearVisible);
  }
 }catch(error){console.error(error);process.exitCode=1;}
 finally{
  if(engine?.connected)await engine.request('clear').catch(()=>{});
  engine?.close();browser?.kill();
  // Store installations can start a separate browser process from the launcher.
  // Match this run's exact profile path before closing any of its processes.
  try {
   execFileSync('powershell.exe',['-NoProfile','-Command',
    'Get-CimInstance Win32_Process -Filter "Name=\'firefox.exe\'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:CODY_FIXTURE_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }'],
    {env:{...process.env,CODY_FIXTURE_PROFILE:browserProfile},windowsHide:true,stdio:'ignore'});
  }catch{}
  server.close();await wait(800);app.exit(process.exitCode||0);
 }
});
