'use strict';
const {app,BrowserWindow,ipcMain}=require('electron'),{EventEmitter}=require('node:events');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {UpdateService,registerUpdateIpc}=require('../frontend/original-cody/src/updates');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const errors=[],checks=[];
  const win=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{preload:path.join(__dirname,'updates-preview-preload.cjs'),contextIsolation:true,sandbox:false,offscreen:true,backgroundThrottling:false}});
  win.webContents.on('console-message',(_event,_level,message)=>{if(/Uncaught|TypeError|ReferenceError/.test(message))errors.push(message);});
  const client=new EventEmitter();
  client.checkForUpdates=async()=>client.emit('update-available',{version:'0.15.2'});
  let finishDownload;
  client.downloadUpdate=()=>new Promise(resolve=>{
    finishDownload=()=>{client.emit('update-downloaded',{version:'0.15.2'});resolve();};
    client.emit('download-progress',{percent:43});
  });
  const installs=[];client.quitAndInstall=(...args)=>installs.push(args);
  const updates=new UpdateService({version:'0.15.1',packaged:true,platform:'win32',createUpdater:()=>client});
  updates.on('change',value=>win.webContents.send('updates-state',value));
  registerUpdateIpc({ipcMain,updates,getWindow:()=>win,shell:{openExternal:()=>{}}});
  const evaluate=code=>win.webContents.executeJavaScript(code);
  async function until(code){for(let n=0;n<40;n++){if(await evaluate(code))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('UI condition timed out: '+code);}
  try{
    await win.loadFile(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'true'}});
    await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}');
    await until('Boolean(window.CODYIsland)&&document.getElementById("update-version").textContent.includes("0.15.1")');
    // Run the actual island renderer against isolated update and monitor states.
    const assistantSource=await fs.readFile(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/assistant.js'),'utf8');
    const begin=assistantSource.indexOf('function renderTimer(){');
    const render=assistantSource.slice(begin,assistantSource.indexOf("document.addEventListener('cody:update-state'",begin));
    await evaluate("var $=id=>document.getElementById(id),wakeListening=()=>false,capture={status:'idle'},capturePending=false,taskStatus=null,visibleTaskStatus=null,game={active:false},timer=null,quickCard=null,media={available:false},island=window.CODYIsland,art=$('island-media-art'),monitors={active:true,items:[{id:'ram',text:'RAM 69%',detail:'10.7 / 15.6 GB',icon:'activity'}]};"+render+"document.addEventListener('cody:update-state',renderTimer);renderTimer();window.CODYIsland.showIsland(true);");
    updates.set({status:'downloading',availableVersion:'0.15.2',progress:43});
    await until("document.getElementById('island-info').dataset.update==='true'");
    assert.equal(await evaluate("document.getElementById('island-update-progress').value"),43);
    await evaluate("quickCard={kind:'brightness',text:'Brightness',level:68,expiresAt:Date.now()+5000};renderTimer()");
    assert.equal(await evaluate("$('island-update-progress').getAttribute('aria-label')"),'Brightness level');
    assert.equal(await evaluate("$('island-update-progress').value"),68);
    await evaluate("quickCard=null;renderTimer()");
    assert.equal(await evaluate("$('island-update-progress').getAttribute('aria-label')"),'Update download progress');
    assert.equal(await evaluate("$('island-update-progress').value"),43);
    for(const size of ['small','medium','large']){
      await evaluate(`document.body.dataset.size=${JSON.stringify(size)}`);
      const fits=await evaluate("(()=>{const t=$('island-info-text'),p=$('island-update-progress');return t.scrollWidth<=t.clientWidth&&!p.hidden&&p.getBoundingClientRect().height>0;})()");
      assert.ok(fits,'Update percentage fits '+size+' island');
    }
    await evaluate("document.body.dataset.size='medium';capture={status:'recording',elapsedMs:0,capturedAt:Date.now()};renderTimer()");
    assert.equal(await evaluate("$('island-info').dataset.update"),'false');assert.equal(await evaluate("$('island-update-progress').hidden"),true);
    await evaluate("capture={status:'idle'};renderTimer()");
    await evaluate("wakeListening=()=>true;renderTimer()");
    assert.equal(await evaluate("$('island-info-text').textContent"),'Listening…');
    await evaluate("wakeListening=()=>false;timer={status:'finished',deadline:Date.now()};renderTimer()");
    assert.equal(await evaluate("$('island-timer').hidden"),false);
    assert.equal(await evaluate("$('island-info').dataset.update"),'false');
    await evaluate("timer=null;renderTimer()");
    await fs.mkdir(path.resolve(__dirname,'../../docs/screenshots'),{recursive:true});
    win.webContents.setZoomFactor(2);
    await new Promise(resolve=>setTimeout(resolve,450));
    const bounds=await evaluate("(()=>{const r=$('island').getBoundingClientRect();return {x:Math.round(r.x*2),y:Math.round(r.y*2),width:Math.round(r.width*2),height:Math.round(r.height*2)};})()");
    if(!process.argv.includes('--no-screenshots'))await fs.writeFile(path.resolve(__dirname,'../../docs/screenshots/update-status.png'),(await win.webContents.capturePage(bounds)).toPNG());
    win.webContents.setZoomFactor(1);
    await evaluate("$('island-info').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    await until("document.body.classList.contains('settings-open')&&!document.querySelector('[data-content=updates]').hidden");
    updates.set({status:'idle'});await until("$('island-info').dataset.monitor==='ram'");
    assert.equal(await evaluate("$('island-update-progress').hidden"),true);
    updates.set({status:'error',error:'Connection failed'});await until("$('island-info-text').textContent==='Update failed'");
    assert.match(await evaluate("$('island-info').getAttribute('aria-label')"),/Connection failed/);
    updates.set({status:'idle'});
    checks.push('island percentage and progress fit all sizes; recording takes priority; keyboard opens Updates; RAM returns');
    await evaluate('window.CODYIsland.togglePanel(false)');
    await updates.check();await until("$('island-info').dataset.update==='true'");
    await evaluate("$('island-info').click()");
    await until("document.body.classList.contains('settings-open')&&!document.querySelector('[data-content=updates]').hidden&&document.activeElement.id==='update-apply'");
    checks.push('first click on an available update selects Updates and focuses the update button');
    if(!process.argv.includes('--no-screenshots'))await fs.writeFile(path.resolve(__dirname,'../reports/updates-available.png'),(await win.webContents.capturePage()).toPNG());
    const layout=await evaluate('(()=>{const page=document.querySelector("[data-content=updates]"),button=document.getElementById("update-apply"),r=button.getBoundingClientRect();return {visible:!page.hidden,width:r.width,height:r.height,right:r.right,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,scroll:page.scrollWidth,client:page.clientWidth};})()');
    assert.ok(layout.visible&&layout.width>0&&layout.height>15&&layout.right<=layout.viewportWidth&&layout.bottom<=layout.viewportHeight&&layout.scroll<=layout.client);checks.push('update page and primary action fit inside window');
    await evaluate("$('update-apply').click()");
    await until("!$('update-progress').hidden&&$('update-progress').value===43&&$('update-apply').hidden");
    finishDownload();
    await until("$('update-status').textContent.includes('reopen automatically')");
    assert.deepEqual(installs,[[true,true]]);checks.push('one click shows download progress and runs silent install with restart');
    updates.set({status:'development',supported:false});await until('document.getElementById("update-check").disabled');checks.push('development UI explains unavailable installation');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,layout}));
  }catch(error){console.error(error,errors);app.exitCode=1;}
  finally{updates.close();win.destroy();app.exit(app.exitCode||0);}
});
