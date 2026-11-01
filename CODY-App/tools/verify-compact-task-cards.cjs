'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);
 try{
  const end=Date.now()+20000;while(Date.now()<end&&!await evaluate('Boolean(window.CODYTasks&&window.CODYIsland?.integrationReady)'))await wait(80);
  island.show();await evaluate('window.CODYTasks.open()');await wait(700);
  const count=await evaluate(`document.querySelectorAll('.task-row').length`);for(let i=0;i<count;i++){await evaluate(`document.querySelectorAll('.task-row')[${i}].scrollIntoView({block:'center'})`);await wait(700);}await wait(500);
  const layout=await evaluate(`(()=>{const list=document.getElementById('tasks-list').getBoundingClientRect();return{panelHeight:document.getElementById('island').getBoundingClientRect().height,cards:[...document.querySelectorAll('.task-row')].map(row=>{const preview=row.querySelector('.task-preview').getBoundingClientRect(),header=row.querySelector('.task-card-heading').getBoundingClientRect(),footer=row.querySelector('.task-card-footer').getBoundingClientRect(),card=row.getBoundingClientRect(),img=row.querySelector('.task-website-preview>img');return{title:row.querySelector('.task-card-title strong').textContent,headerHeight:header.height,iconWidth:row.querySelector('.task-icon').getBoundingClientRect().width,previewWidth:preview.width,previewHeight:preview.height,cardHeight:card.height,website:Boolean(img),buttonWidth:row.querySelector('.task-close').getBoundingClientRect().width,footerFits:footer.bottom<card.bottom,firstRowFits:card.top>list.top+5||card.bottom<=list.bottom,fit:img?getComputedStyle(img).objectFit:null};})};})()`);
  if(!layout.cards.length)throw Error('No saved task cards available');
  results.push({name:'all task previews match browser cards with compact metadata',passed:layout.cards.some(c=>c.website)&&layout.cards.every(c=>{const browser=layout.cards.find(b=>b.website&&Math.abs(b.previewWidth-c.previewWidth)<1);return c.headerHeight<=40&&c.iconWidth===24&&c.buttonWidth===19&&browser&&Math.abs(c.previewHeight-browser.previewHeight)<1&&Math.abs(c.cardHeight-browser.cardHeight)<1&&c.footerFits&&(!c.fit||c.fit==='contain');}),layout});
  if(!results[0].passed)throw Error('Card geometry check failed');
  await evaluate(`document.querySelector('.task-website-preview')?.closest('.task-row').scrollIntoView({block:'center'})`);await wait(300);
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/compact-task-cards.png'),(await win.webContents.capturePage(clip)).toPNG());
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 fs.writeFileSync(path.resolve(__dirname,'../reports/compact-task-cards-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
};
