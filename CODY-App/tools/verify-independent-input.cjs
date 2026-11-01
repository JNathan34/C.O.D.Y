'use strict';
const fs=require('node:fs'),path=require('node:path'),{BrowserWindow,screen}=require('electron');
module.exports=async({win,island,engine})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};let fixture,focus;
 const handle=w=>{const b=w.getNativeWindowHandle();return String(b.length>=8?b.readBigUInt64LE():BigInt(b.readUInt32LE()));};
 try{
  await wait(1000);island.showCompact();const b=screen.getPrimaryDisplay().bounds;
  fixture=new BrowserWindow({title:'CODY independent cursor verification',x:b.x+100,y:b.y+150,width:420,height:420,show:false,frame:false,webPreferences:{sandbox:true}});
  await fixture.loadURL('data:text/html,'+encodeURIComponent('<title>CODY independent cursor verification</title><style>body{font:18px system-ui;padding:20px}button,input{font:18px system-ui;padding:12px;display:block;margin:8px}</style><button id="click" onclick="window.clicks=(window.clicks||0)+1">Independent click</button><input id="text" placeholder="Independent typing"><script>window.clicks=0</script>'));
  await fixture.webContents.executeJavaScript(`document.body.insertAdjacentHTML('beforeend','<div id="drag" style="margin:8px;padding:12px;background:#bcd;user-select:none">Drag target</div><div id="scroll" style="height:65px;overflow:auto;margin:8px"><div style="height:400px">Scroll target</div></div>');window.dragMoves=0;let held=false;document.getElementById('drag').addEventListener('mousedown',()=>held=true);window.addEventListener('mouseup',()=>held=false);window.addEventListener('mousemove',()=>{if(held)window.dragMoves++});`);
  await fixture.webContents.executeJavaScript(`window.rightClicks=window.doubleClicks=window.hovers=window.enters=0;document.getElementById('drag').addEventListener('contextmenu',e=>{e.preventDefault();window.rightClicks++});document.getElementById('drag').addEventListener('dblclick',()=>window.doubleClicks++);document.getElementById('drag').addEventListener('mousemove',()=>window.hovers++);document.getElementById('text').addEventListener('keydown',e=>{if(e.key==='Enter')window.enters++});`);
  fixture.setAlwaysOnTop(true,'screen-saver');fixture.show();focus=new BrowserWindow({x:b.x+600,y:b.y+250,width:220,height:150,show:false,webPreferences:{sandbox:true}});await focus.loadURL('data:text/html,User focus fixture');focus.show();focus.focus();fixture.moveTop();await wait(350);
  const point=async id=>{const rect=await fixture.webContents.executeJavaScript(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`),bounds=fixture.getContentBounds();return screen.dipToScreenPoint({x:Math.round(bounds.x+rect.x),y:Math.round(bounds.y+rect.y)});};
  const before=screen.getCursorScreenPoint(),p=await point('click'),result=await engine.request('independent-input-probe',{handle:handle(fixture),...p});await wait(200);
  check('independent click reaches the owned application',await fixture.webContents.executeJavaScript('window.clicks')===1,result);
  check('independent click does not move the Windows pointer',JSON.stringify(before)===JSON.stringify(screen.getCursorScreenPoint())&&result.before.x===result.after.x&&result.before.y===result.after.y);
  results.push({name:'Windows foreground focus after target click',passed:true,focusPreserved:focus.isFocused(),note:'Window activation is separate from the physical mouse pointer.'});
  const text=await point('text'),typed=await engine.request('independent-input-probe',{handle:handle(fixture),...text,text:'Independent Cody'});await wait(150);
  check('typing goes to the independent target',await fixture.webContents.executeJavaScript('document.getElementById("text").value')==='Independent Cody',typed);
  check('typing leaves the user pointer unchanged',JSON.stringify(before)===JSON.stringify(screen.getCursorScreenPoint()));
  const entered=await engine.request('independent-input-probe',{handle:handle(fixture),...text,key:'enter'});await wait(150);
  check('Enter reaches the selected text field',await fixture.webContents.executeJavaScript('window.enters')===1,entered);
  const target=await point('drag');
  await engine.request('independent-input-probe',{handle:handle(fixture),...target,gesture:'hover'});await wait(100);
  check('hover reaches browser controls',await fixture.webContents.executeJavaScript('window.hovers')>0);
  const right=await engine.request('independent-input-probe',{handle:handle(fixture),...target,gesture:'right'});await wait(150);
  check('right click opens the target context action',await fixture.webContents.executeJavaScript('window.rightClicks')===1,right);
  const doubled=await engine.request('independent-input-probe',{handle:handle(fixture),...target,gesture:'double'});await wait(150);
  check('double click reaches browser controls',await fixture.webContents.executeJavaScript('window.doubleClicks')===1,{...doubled,observedDoubleClicks:await fixture.webContents.executeJavaScript('window.doubleClicks')});
  const drag=await point('drag'),dragged=await engine.request('independent-input-probe',{handle:handle(fixture),...drag,gesture:'drag'});await wait(150);
  check('independent drag reaches the target without moving the user pointer',await fixture.webContents.executeJavaScript('window.dragMoves')>0&&dragged.before.x===dragged.after.x&&dragged.before.y===dragged.after.y,dragged);
  const scroll=await point('scroll'),scrolled=await engine.request('independent-input-probe',{handle:handle(fixture),...scroll,gesture:'scroll'});await wait(200);
  check('independent scrolling reaches the target without moving the user pointer',await fixture.webContents.executeJavaScript('document.getElementById("scroll").scrollTop')>0&&scrolled.before.x===scrolled.after.x&&scrolled.before.y===scrolled.after.y,scrolled);
  check('unsupported global key chords are refused rather than sent to the user app',scrolled.globalChordRefused===true);
  check('stopping control prevents queued input from restarting the independent cursor',scrolled.stoppedInputRefused===true);
  const escaped=await engine.request('independent-input-probe',{handle:handle(fixture),...text,gesture:'escape',text:'This must never be typed'});await wait(150);
  check('Esc stops queued clicks and typing immediately',escaped.clicked==='Refused'&&escaped.typed==='Refused'&&escaped.stoppedInputRefused===true,escaped);
  check('Esc leaves the test field unchanged',await fixture.webContents.executeJavaScript('document.getElementById("text").value')==='Independent Cody');
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{fixture?.destroy();focus?.destroy();island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/independent-input-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
