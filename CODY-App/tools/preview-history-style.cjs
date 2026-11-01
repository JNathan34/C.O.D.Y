'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,store})=>{
 const chats=store.data.chats,active=store.data.activeChatId,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code);
 try{
  const deadline=Date.now()+30000;while(Date.now()<deadline&&!await evaluate('Boolean(window.CODYIsland?.integrationReady)'))await wait(100);
  const current={id:'CODY-style-empty',title:'New chat',messages:[],updatedAt:new Date().toISOString()};
  const titles=['Website ideas','Weekend plans','A better morning routine','Help with the project','Music for the evening','Computer settings'];
  store.data.chats=[current,...Array.from({length:36},(_,i)=>({id:'CODY-style-'+i,title:titles[i%titles.length],messages:[{id:'preview-'+i,role:'user',text:'Layout preview'}],updatedAt:new Date(Date.now()-i*100000).toISOString()}))];store.data.activeChatId=current.id;win.webContents.send('chats-changed',store.publicState());
  island.show();await evaluate(`window.CODYIsland.setActiveView('history')`);await wait(800);
  const layout=await evaluate(`(()=>{const empty=document.getElementById('empty-state').getBoundingClientRect(),area=document.getElementById('conversation').getBoundingClientRect(),sidebar=document.querySelector('.history-sidebar').getBoundingClientRect(),list=document.getElementById('history-list');list.scrollTop=100;const scrollable=list.scrollTop>0;list.scrollTop=0;return{centeredHorizontally:Math.abs((empty.left+empty.right-area.left-area.right)/2)<2,centeredVertically:Math.abs((empty.top+empty.bottom-area.top-area.bottom)/2)<2,sidebarWidth:sidebar.width,headingRemoved:!document.querySelector('.history-sidebar h2'),scrollbarHidden:getComputedStyle(list).scrollbarWidth==='none',scrollable};})()`);
  fs.writeFileSync(path.resolve(__dirname,'../reports/history-refined-layout.json'),JSON.stringify(layout,null,2));
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/history-refined.png'),(await win.webContents.capturePage(clip)).toPNG());
 }finally{store.data.chats=chats;store.data.activeChatId=active;store.save();win.webContents.send('chats-changed',store.publicState());island.showCompact();}
};
