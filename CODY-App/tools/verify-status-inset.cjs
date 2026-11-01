const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:940,height:750,webPreferences:{sandbox:true,backgroundThrottling:false}});try{
 await win.loadFile(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'1'}});
 await win.webContents.executeJavaScript(`window.CODYIsland.showIsland(true);window.CODYIsland.togglePanel(true);window.CODYIsland.setActiveView('chat');`);await new Promise(r=>setTimeout(r,800));
 const layouts=await win.webContents.executeJavaScript(`(()=>{const info=document.getElementById('island-info'),timer=document.getElementById('island-timer'),result=[];for(const mode of ['ram','spotify','app','timer']){info.hidden=mode==='timer';timer.hidden=mode!=='timer';info.classList.toggle('showing-media',mode==='spotify');document.body.classList.toggle('utility-layout',mode==='app');document.getElementById('island-info-text').textContent=mode==='ram'?'RAM 92%':mode==='spotify'?'Spotify':'Opening Firefox';const el=mode==='timer'?timer:info;result.push({mode,left:getComputedStyle(el).left});}info.hidden=false;timer.hidden=true;info.classList.remove('showing-media');document.body.classList.remove('utility-layout');document.getElementById('island-info-text').textContent='RAM 92%';document.getElementById('island-info-detail').textContent='14.4 / 15.6 GB';return result;})()`);
 if(layouts.some(x=>x.left!=='32px'))throw Error(JSON.stringify(layouts));
 const clip=await win.webContents.executeJavaScript(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);
 fs.writeFileSync(path.resolve(__dirname,'../reports/status-inset.png'),(await win.webContents.capturePage(clip)).toPNG());fs.writeFileSync(path.resolve(__dirname,'../reports/status-inset.json'),JSON.stringify({passed:true,layouts},null,2));
 }catch(e){fs.writeFileSync(path.resolve(__dirname,'../reports/status-inset.json'),JSON.stringify({passed:false,error:e.stack}));}finally{win.destroy();app.quit();}});


