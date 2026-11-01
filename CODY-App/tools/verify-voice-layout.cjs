'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island})=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);let result;
 try{
  const end=Date.now()+30000;while(Date.now()<end&&!await evaluate('Boolean(window.CODYIsland?.integrationReady)'))await wait(100);
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="voice"]').click()`);await wait(700);
  result=await evaluate(`(()=>{const grid=document.getElementById('voice-options'),tiles=[...grid.children].map(t=>t.getBoundingClientRect()),g=grid.getBoundingClientRect(),parent=grid.parentElement.getBoundingClientRect(),group=document.querySelector('[data-content="voice"] .settings-group').getBoundingClientRect();return{passed:tiles.length===10&&Math.max(...tiles.map(t=>t.width))-Math.min(...tiles.map(t=>t.width))<1&&Math.abs(tiles[4].right-group.right)<1&&Math.abs(tiles[9].right-group.right)<1&&Math.abs(g.width-group.width)<1,widths:tiles.map(t=>t.width),gridWidth:g.width,sectionWidth:group.width};})()`);
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/voice-layout.png'),(await win.webContents.capturePage(clip)).toPNG());
 }catch(error){result={passed:false,error:error.stack};}
 finally{island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/voice-layout-live.json'),JSON.stringify(result,null,2));}
};
