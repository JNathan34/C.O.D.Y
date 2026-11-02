'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,store,attachments,engine})=>{
  const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code),voice=store.data.settings.voiceAutoSpeak;
  let chatId,original,attachedDebugger=false;
  const uiOnly=process.argv.includes('--verify-attachments-ui'),reportFile=path.resolve(__dirname,'../reports/'+(uiOnly?'attachments-ui-live.json':'attachments-live.json'));
  const save=()=>fs.writeFileSync(reportFile,JSON.stringify({passed:results.every(result=>result.passed),complete:false,results},null,2));
  const check=(name,passed,detail)=>{results.push({name,passed,detail});save();if(!passed)throw Error(name);};
  async function until(predicate,timeout=45000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await predicate())return;await wait(150);}throw Error('Attachment check timed out');}
  async function drop(file){
    island.showCompact();island.setFileDragActive(true);await wait(350);
    const point=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return {x:r.x+r.width/2,y:10};})()`),data={items:[],files:[file],dragOperationsMask:1};
    await win.webContents.debugger.sendCommand('Input.dispatchDragEvent',{type:'dragEnter',...point,data});
    await win.webContents.debugger.sendCommand('Input.dispatchDragEvent',{type:'dragOver',...point,data});await wait(150);
    check('file drag highlights the compact Island',await evaluate(`document.body.classList.contains('file-dragging')&&!document.getElementById('file-drop-hint').hidden`));
    await win.webContents.debugger.sendCommand('Input.dispatchDragEvent',{type:'drop',...point,data});
    await win.webContents.debugger.sendCommand('Input.dispatchDragEvent',{type:'dragCancel',...point,data});
    await until(()=>evaluate(`window.CODYAttachments.state().items.some(file=>file.name===${JSON.stringify(path.basename(file))})`));
    await until(()=>evaluate(`!document.body.classList.contains('file-dragging')&&document.body.classList.contains('panel-open')&&getComputedStyle(document.getElementById('file-drop-hint')).display==='none'`));await wait(800);
  }
  async function prompt(text){await evaluate(`window.CODYIsland.onPrompt(${JSON.stringify(text)})`);await until(async()=>!await evaluate('window.assistant.state().then(s=>s.busy)'),150000);}
  try{
    await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady&&window.CODYAttachments)'));chatId=store.data.activeChatId;
    original=JSON.parse(JSON.stringify(store.chat(chatId).attachments||[]));store.chat(chatId).attachments=[];store.data.settings.voiceAutoSpeak=false;await attachments.publish(chatId);
    if(!win.webContents.debugger.isAttached()){win.webContents.debugger.attach('1.3');attachedDebugger=true;}
    const before=store.chat(chatId).messages.length,image=path.resolve(__dirname,'../frontend/original-cody/assets/brand/cody-64.png');
    await drop(image);
    check('dropping stages a real file without submitting a message',store.chat(chatId).messages.length===before);
    check('drop opens the chat with a removable image preview',await evaluate(`document.body.classList.contains('panel-open')&&document.querySelector('#attachment-list img')!==null&&document.querySelector('#attachment-list .attachment-remove')!==null`));
    const bounds=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return {x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);
    fs.writeFileSync(path.resolve(__dirname,'../reports/island-file-attachment.png'),(await win.webContents.capturePage(bounds)).toPNG());
    if(uiOnly){await evaluate(`document.querySelector('#attachment-list .attachment-remove').click()`);await until(()=>evaluate('window.CODYAttachments.state().items.length===0'));check('remove button clears the staged attachment',(await attachments.paths(chatId)).length===0);return;}
    await prompt("In the attached image only, what colour is the robot's outer ring? Reply with the colour only.");
    const imageReply=store.chat(chatId).messages.filter(message=>message.role==='assistant').at(-1)?.text||'';
    check('real HeyClicky image question reads the attached image',/blue|cyan|turquoise/i.test(imageReply),{reply:imageReply});
    await until(()=>evaluate('window.CODYAttachments.state().items.length===0'));
    check('sending the file clears future attachment context',(await attachments.paths(chatId)).length===0);
    const document=path.resolve(__dirname,'../reports/attachment-live-fixture-'+Date.now()+'.txt');fs.writeFileSync(document,'Calibration number: 48127\nTest token: CODY_OLD\n');
    await drop(document);await prompt('Read the attached local test file. Tell me its calibration number, and replace the exact token CODY_OLD with CODY_NEW in that same file. Keep the other content unchanged. This is a harmless attachment feature test; do not edit any other files. Reply briefly when finished.');
    await until(()=>fs.readFileSync(document,'utf8').includes('CODY_NEW'),150000);
    check('real HeyClicky file work edits the attached test document',fs.readFileSync(document,'utf8')==='Calibration number: 48127\nTest token: CODY_NEW\n',{file:document});
    await until(()=>store.chat(chatId).messages.some(message=>message.role==='assistant'&&message.text.includes('48127')),90000);
    check('document answer or completed file-work report reaches the chat',true);
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
  finally{
    island.setFileDragActive(false);if(attachedDebugger&&win.webContents.debugger.isAttached())win.webContents.debugger.detach();
    if(chatId&&original){store.chat(chatId).attachments=original;await attachments.publish(chatId);}store.data.settings.voiceAutoSpeak=voice;store.save();
    fs.writeFileSync(reportFile,JSON.stringify({passed:results.every(result=>result.passed),complete:true,results},null,2));
  }
};
