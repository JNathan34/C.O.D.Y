'use strict';
// A real second process is essential: the Island and engine have different PIDs.
const {app,BrowserWindow,screen,desktopCapturer}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeEngine}=require('../frontend/original-cody/src/native-engine');
const {manageWindow}=require('../frontend/original-cody/src/control/app-layout');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cody-drawing-owner-'));
app.setPath('userData',profile);
fs.mkdirSync(path.join(profile,'native-account'));
fs.writeFileSync(path.join(profile,'native-account','settings.json'),JSON.stringify({drawing_sounds_enabled:false}));
app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const handle=win=>win.getNativeWindowHandle().readBigUInt64LE().toString();
let win,other,child,engine,chatgpt;const checks=[];
const html='<body style="margin:0;background:#eef2f7"><h1>Drawing ownership fixture</h1><button id="target" style="position:absolute;left:120px;top:200px;width:180px;height:90px">Original target</button><div style="height:2000px"></div></body>';
async function focus(window){window.setAlwaysOnTop(true);window.show();window.moveTop();window.focus();window.webContents.focus();await window.webContents.executeJavaScript('document.getElementById("target")?.focus()');await wait(180);assert.ok(window.isFocused(),'owned fixture must receive focus');}
app.whenReady().then(async()=>{
 if(process.argv.includes('--target')){
  win=new BrowserWindow({x:80,y:220,width:680,height:580,show:false,webPreferences:{backgroundThrottling:false}});
  await win.loadURL('data:text/html,'+encodeURIComponent(html));await focus(win);
  const title=`Drawing ownership target ${process.pid}`;
  win.setTitle(title);
  process.on('message',async message=>{try{
   if(message.command==='focus')await focus(win);
   if(message.command==='minimize')win.minimize();
   if(message.command==='restore'){win.restore();await wait(200);await focus(win);}
   if(message.command==='other'){
    if(!other){other=new BrowserWindow({x:820,y:220,width:340,height:300,show:false});await other.loadURL('data:text/html,<h2>Unrelated app</h2>');}
    await focus(other);
   }
   if(message.command==='quit'){app.quit();return;}
   if(message.command==='bounds'){
    const rect=await win.webContents.executeJavaScript('(()=>{const r=document.getElementById("target").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()');
    const origin=win.getContentBounds();process.send({id:message.id,x:origin.x+rect.x,y:origin.y+rect.y,width:rect.width,height:rect.height});return;
   }
   process.send({id:message.id,handle:handle(win),focused:win.isFocused(),visible:win.isVisible()});
  }catch(error){process.send({id:message.id,error:error.message});}});
  process.send({ready:true,handle:handle(win),title});return;
 }
 const pending=new Map();let sequence=0;
 const command=value=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('Child fixture timeout')),8000);pending.set(id,{resolve,reject,timer});child.send({id,command:value});});
 async function state(){return engine.request('drawing-controls-state');}
 async function until(label,predicate){let value;for(let i=0;i<100;i++){value=await state();if(value.error)throw Error(value.error);if(predicate(value)){checks.push(label);console.log('PASS: '+label);return value;}await wait(100);}throw Error(label+': '+JSON.stringify(value));}
 try{
  const ready=new Promise((resolve,reject)=>{
   const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
   child=spawn(process.execPath,[__filename,'--target'],{env,windowsHide:false,stdio:['ignore','pipe','pipe','ipc']});
   child.on('error',reject);child.on('message',message=>{if(message.ready)resolve(message);else {const task=pending.get(message.id);if(task){pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(message.error)):task.resolve(message);}}});
   child.stderr.on('data',data=>process.stderr.write(data));
  });
  const target=await ready;
  engine=new NativeEngine();await engine.refresh();
  win=new BrowserWindow({x:60,y:40,width:360,height:140,show:false,title:'Owned Island stand-in',webPreferences:{backgroundThrottling:false}});
  await win.loadURL('data:text/html,<h2>Island stand-in</h2><input autofocus>');await focus(win);
  await engine.request('text-client',{clientPid:process.pid,islandWindow:handle(win)});
  await command('focus');await wait(300);
  await focus(win);
  const display=screen.getPrimaryDisplay();
  // The page button's position includes the OS frame; obtain its actual screen box.
  // Use an existing child RPC below instead of guessing frame/DPI offsets.
  const box=await command('bounds');
  async function inkOnScreen(label){
   await wait(1400); // Finish the intentional initial pen-reveal animation.
   const scale=display.scaleFactor,size={width:Math.round(display.size.width*scale),height:Math.round(display.size.height*scale)};
   const source=(await desktopCapturer.getSources({types:['screen'],thumbnailSize:size})).find(item=>item.display_id===String(display.id));
   const image=source.thumbnail,actual=image.getSize(),pixels=image.toBitmap();let blue=0;
   const sx=actual.width/display.size.width,sy=actual.height/display.size.height;
   for(let y=Math.max(0,Math.floor((box.y-12)*sy));y<Math.min(actual.height,(box.y+box.height+12)*sy);y++)
    for(let x=Math.max(0,Math.floor((box.x-12)*sx));x<Math.min(actual.width,(box.x+box.width+12)*sx);x++){
     const i=(y*actual.width+x)*4,b=pixels[i],g=pixels[i+1],r=pixels[i+2];if(b>150&&g>75&&b>r*1.35&&b>g*1.05)blue++;
    }
   if(blue<200)fs.writeFileSync(path.resolve(__dirname,'../reports/drawing-owner-screen.png'),image.toPNG());
   assert.ok(blue>=200,label+': actual desktop image contains '+blue+' blue ink pixels');checks.push(label);console.log('PASS: '+label+' ('+blue+' ink pixels)');
  }
  await engine.request('drawing-controls-test-highlight',{window:target.handle,marks:[{x:box.x/display.size.width,y:box.y/display.size.height,width:box.width/display.size.width,height:box.height/display.size.height}]});
  const initial=await state();assert.equal(initial.follow?.owner,target.handle,'a request from the Island must capture the external app, not the Island');
  await until('drawing appears while the Island retains focus',s=>s.follow?.marks.some(m=>m.visible&&!m.anchored));
  assert.ok(win.isFocused(),'showing a drawing must not steal keyboard focus');
  await inkOnScreen('ink is visible on the actual desktop while the Island has focus');
  await command('focus');await until('drawing stays visible when returning to the target app',s=>s.follow?.owner===target.handle&&s.follow.marks.some(m=>m.visible));
  await wait(600);await inkOnScreen('ink stays above the foreground target without an Island click');
  chatgpt=new BrowserWindow({parent:win,x:820,y:220,width:340,height:300,show:false});
  await chatgpt.loadURL('data:text/html,<title>ChatGPT session fixture</title><h2>ChatGPT session fixture</h2>');
  await focus(chatgpt);
  await until('the separate ChatGPT window hides the drawing even when owned by the Island',s=>
    s.follow?.foreground===handle(chatgpt)&&s.follow.marks.every(m=>!m.visible)&&s.renderedUnits===0);
  await manageWindow({windowName:target.title,operation:'focus'});
  await until('returning from ChatGPT restores the original drawing',s=>s.follow?.marks.some(m=>m.visible));
  chatgpt.destroy();chatgpt=null;
  await command('other');
  await until('drawing hides over another window from the same process',s=>s.follow?.marks.length>0&&s.follow.marks.every(m=>!m.visible)&&s.renderedUnits===0&&!s.clearVisible);
  await focus(win);await until('opening the Island does not retarget the drawing from the unrelated app',s=>s.follow?.marks.length>0&&s.follow.marks.every(m=>!m.visible));
  await command('focus');await until('original drawing returns without clicking the Island',s=>s.follow?.marks.some(m=>m.visible));
  await command('minimize');await until('minimized target hides its drawing',s=>s.follow?.marks.length>0&&s.follow.marks.every(m=>!m.visible));
  await command('restore');await until('restoring the target restores its drawing',s=>s.follow?.marks.some(m=>m.visible));
  await engine.request('clear');await until('clear removes the drawing',s=>!s.showing);
 }catch(error){console.error(error.stack);process.exitCode=1;}
 finally{
  fs.mkdirSync(path.resolve(__dirname,'../reports'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../reports/drawing-owner.json'),JSON.stringify({passed:!process.exitCode,checks},null,2));
  if(engine){await engine.request('clear').catch(()=>{});engine.close();}
  if(child?.connected)child.send({command:'quit'});
  chatgpt?.destroy();win?.destroy();other?.destroy();await wait(600);app.exit(process.exitCode||0);
 }
});
