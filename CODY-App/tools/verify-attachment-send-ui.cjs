'use strict';
const {app,BrowserWindow,ipcMain}=require('electron'),{EventEmitter}=require('node:events'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),assert=require('node:assert/strict');
const {Attachments}=require('../frontend/original-cody/src/attachments'),{installNativeIpc}=require('../frontend/original-cody/src/native-ipc');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cody-attachment-ui-')),file=path.join(folder,'brief.txt');await fs.writeFile(file,'Preview only.');
 const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,preload:path.join(__dirname,'attachment-send-preview-preload.cjs'),contextIsolation:true,sandbox:false,backgroundThrottling:false}});
 const chat={id:'preview',messages:[]},store={data:{activeChatId:'preview',settings:{},chats:[chat]},chat:id=>id===chat.id?chat:null,save(){},publicState(){return this.data;},addMessage(id,role,text){const message={id:String(chat.messages.length),role,text};chat.messages.push(message);return message;},updateMessage(id,key,text){chat.messages.find(message=>message.id===key).text=text;}};
 const sendUI=(name,value)=>win.webContents.send(name,value),attachments=new Attachments({store,onChange:value=>sendUI('attachments-state',value)}),engine=new EventEmitter();
 engine.status={state:'Idle'};engine.refresh=async()=>({signedIn:true});engine.request=async()=>({text:'Preview answer'});
 // Only the fixture file is accepted by this preview bridge; no real AI request is made.
 installNativeIpc({ipcMain:{removeHandler:name=>ipcMain.removeHandler(name),handle:(name,fn)=>ipcMain.handle(name,(event,...args)=>fn(event,...(name==='attachments-add'?[[file]]:args)))},engine,store,attachments,sendUI,getWindow:()=>win,utilities:{match:()=>null,observe(){},cancel(){}}});
 const evaluate=code=>win.webContents.executeJavaScript(code);
 async function until(code){for(let n=0;n<60;n++){if(await evaluate(code))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('UI condition timed out: '+code);}
 try{
  await win.loadFile(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'true'}});
  await until('!!window.CODYAttachments');
  await evaluate('(()=>{const data=new DataTransfer();data.items.add(new File(["preview"],"brief.txt"));document.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:data}));})()');
  await until('document.querySelectorAll("#attachment-list .attachment-chip").length===1');
  assert.equal(await evaluate('document.getElementById("quick-input").placeholder'),'Ask about the attached file…');
  await evaluate('window.assistant.previewSend()');await until('document.getElementById("attachment-list").hidden');
  assert.equal(await evaluate('document.getElementById("quick-input").placeholder'),'Message C.O.D.Y.');assert.deepEqual(await attachments.paths(chat.id),[]);assert.equal(chat.messages[0].attachments[0].name,'brief.txt');assert.equal(await fs.readFile(file,'utf8'),'Preview only.');
  console.log(JSON.stringify({passed:true,checks:['drop stages the file chip','sending clears the chip and resets input placeholder','sent message retains attachment metadata','source file preserved']}));
 }catch(error){console.error(error);app.exitCode=1;}
 finally{win.destroy();await fs.rm(folder,{recursive:true,force:true});app.exit(app.exitCode||0);}
});
