'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,store,controller,engine})=>{
  const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code),voice=store.data.settings.voiceAutoSpeak,execute=controller.execute;
  let response;
  const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
  async function until(predicate){const deadline=Date.now()+45000;while(Date.now()<deadline){if(await predicate())return;await wait(100);}throw Error('Split screen verification timed out');}
  try{
    await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));
    const drive=await engine.request('drive-state');if(drive.active){results.push({name:'real window test skipped during active computer control',passed:true});return;}
    store.data.settings.voiceAutoSpeak=false;
    controller.execute=async function(action,...args){try{const result=await execute.call(this,action,...args);if(action==='app.split')response=result;return result;}catch(error){if(action==='app.split')response={ok:false,error:error.message};throw error;}};
    await evaluate(`window.CODYIsland.onPrompt('open Firefox and Plezy in split screen')`);
    await until(()=>Boolean(response));check('typed command executes direct split-screen action',response.ok,response);
    const layout=response.result,first=layout.windows[0],second=layout.windows[1],work=layout.workArea;
    check('Firefox is left and Plezy is right within the actual screen work area',first.app==='firefox'&&second.app==='plezy'&&Math.abs(first.bounds.x-work.x)<=4&&Math.abs(second.bounds.x-(work.x+first.bounds.width))<=8&&Math.abs(first.bounds.height-work.height)<=4&&Math.abs(second.bounds.height-work.height)<=4,layout);
    await until(async()=>!await evaluate('window.assistant.state().then(s=>s.busy)'));await wait(500);
    check('chat collapses so both apps are visible',await evaluate(`!document.body.classList.contains('panel-open')`));
    check('split-screen acknowledgement is shown in the Island',await evaluate(`document.getElementById('island-info-text').textContent==='Split screen'`));
    const bounds=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return {x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);
    fs.writeFileSync(path.resolve(__dirname,'../reports/island-split-screen.png'),(await win.webContents.capturePage(bounds)).toPNG());
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
  finally{controller.execute=execute;store.data.settings.voiceAutoSpeak=voice;store.save();fs.writeFileSync(path.resolve(__dirname,'../reports/app-split-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));}
};
