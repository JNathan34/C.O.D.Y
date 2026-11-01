'use strict';
const fs=require('node:fs');const path=require('node:path');
module.exports=async({win,island,store,engine})=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));const results=[];
  async function send(text){await win.webContents.executeJavaScript(`window.CODYIsland.onPrompt(${JSON.stringify(text)})`);const deadline=Date.now()+30000;while(Date.now()<deadline){await wait(100);if(!await win.webContents.executeJavaScript('window.assistant.state().then(s=>s.busy)'))return;}throw Error('Request timed out');}
  const card=()=>win.webContents.executeJavaScript(`({text:document.getElementById('island-info-text').textContent,detail:document.getElementById('island-info-detail').textContent,visible:!document.getElementById('island-info').hidden})`);
  try{
    const deadline=Date.now()+60000;while(Date.now()<deadline&&!await win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)'))await wait(250);
    island.show();await send('could you open the calculator app for me');await wait(300);
    const opened=await card();results.push({name:'app opened Island card',passed:opened.visible&&opened.text==='Opened'&&opened.detail==='Calculator',card:opened});
    fs.writeFileSync(path.resolve(__dirname,'../reports/app-opened-island.png'),(await win.webContents.capturePage({x:210,y:0,width:520,height:90})).toPNG());
    await send('weather in Derby');await wait(300);const weather=await card();const reply=store.chat(store.data.activeChatId).messages.filter(m=>m.role==='assistant').at(-1)?.text;
    results.push({name:'short natural weather wording',passed:weather.visible&&weather.detail==='Derby'&&/^It's .+ degrees?/.test(reply)&&reply.length<130,reply,card:weather});
    fs.writeFileSync(path.resolve(__dirname,'../reports/app-weather-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));console.log('APP_WEATHER_VERIFICATION '+JSON.stringify(results));
  }catch(error){fs.writeFileSync(path.resolve(__dirname,'../reports/app-weather-live.json'),JSON.stringify({passed:false,error:error.stack,results},null,2));console.error(error);}
};
