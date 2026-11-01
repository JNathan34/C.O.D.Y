'use strict';
const fs=require('node:fs');
const path=require('node:path');
module.exports=async function verify({win,island,store,engine}){
  const reports=path.resolve(__dirname,'../reports');
  try{
    const deadline=Date.now()+60000;
    while(Date.now()<deadline){if(await win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)'))break;await new Promise(r=>setTimeout(r,250));}
    if(!await win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)'))throw Error('Original renderer did not initialize');
    const before=await engine.refresh();
    island.show();
    await new Promise(r=>setTimeout(r,1000));
    if(process.argv.includes('--verify-native-mic')){
      await win.webContents.executeJavaScript('window.CODYIsland.onStartListening();true');
      let listening=false;
      for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,100));if((await engine.refresh()).state==='Listening'){listening=true;break;}}
      await win.webContents.executeJavaScript('window.assistant.voice.cancel()');
      await new Promise(r=>setTimeout(r,300));
      const after=await engine.refresh();
      const result={passed:listening&&after.state==='Idle',listening,cancelled:after.state==='Idle',audioPlaybackStarts:after.audioPlaybackStarts-before.audioPlaybackStarts,submittedRecording:false};
      fs.writeFileSync(path.join(reports,'original-cody-microphone.json'),JSON.stringify(result,null,2));
      console.log('CODY_NATIVE_MIC_VERIFICATION '+JSON.stringify(result));
      return;
    }
    await win.webContents.executeJavaScript(`document.getElementById('quick-input').value='Show me an interactive 3D bicycle and describe it in one short spoken sentence.';document.getElementById('quick-input').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('panel-send').click();`);
    let response='';
    const turnDeadline=Date.now()+150000;
    while(Date.now()<turnDeadline){await new Promise(r=>setTimeout(r,500));const chat=store.chat(store.data.activeChatId);response=chat.messages.filter(m=>m.role==='assistant').at(-1)?.text||'';const status=await engine.refresh();if(response&&status.state==='Idle')break;}
    const after=await engine.refresh();
    const dom=await win.webContents.executeJavaScript(`({reply:document.getElementById('chat-messages').innerText,markup:document.getElementById('island').className})`);
    const capture=await win.webContents.capturePage();fs.writeFileSync(path.join(reports,'original-cody-native-engine.png'),capture.toPNG());
    const result={passed:Boolean(response&&dom.reply.includes(response)&&after.audioPlaybackStarts>before.audioPlaybackStarts),response,renderedReply:dom.reply,audioPlaybackStarts:after.audioPlaybackStarts-before.audioPlaybackStarts,state:after.state,frontend:'original C.O.D.Y. HTML/CSS/animation files',backend:'native HeyClicky session via same-user named pipe'};
    fs.writeFileSync(path.join(reports,'original-cody-native-engine.json'),JSON.stringify(result,null,2));
    console.log('CODY_NATIVE_UI_VERIFICATION '+JSON.stringify(result));
  }catch(error){fs.writeFileSync(path.join(reports,'original-cody-native-engine.json'),JSON.stringify({passed:false,error:error.stack},null,2));console.error(error);}
};
