'use strict';
const windows=require('./windows');
const {taskCategories}=require('./tool-loop');
const {toolReadiness}=require('./readiness');

// Check permissions before starting anything. Launch through the existing
// controller so the selected approval profile still applies to app.open.
async function prepareFirefoxTask(human,{controller,bridge,workingFolder='',runner=windows.runPowerShell,
 timeoutMs=20000,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onActivity=()=>{}}){
 const categories=taskCategories(human);
 const diagnostic=toolReadiness(human,controller.permissions(),{workingFolder,firefoxConnected:true});
 if(diagnostic||!categories.includes('browser'))return diagnostic;
 const failure=reason=>({reason,categories});
 if(!bridge)return failure('Firefox browser tools are unavailable. Restart C.O.D.Y and try again.');
 if(bridge.status().connected)return null;
 try{
  const running=await runner("[bool](Get-Process -Name firefox -ErrorAction SilentlyContinue | Select-Object -First 1) | ConvertTo-Json -Compress");
  if(String(running).trim().toLowerCase()!=='true'){
   onActivity('Opening Firefox…');
   const launched=await controller.execute('app.open',{app:'firefox'},{origin:'ai-chat',verifiedUserIntent:true,humanTask:human});
   if(launched.cancelled)return failure('Opening Firefox was declined. The browser task has not started.');
   if(!launched.ok)throw Error('Firefox could not be opened');
  }
  onActivity('Waiting for Firefox browser tools…');
  const deadline=now()+timeoutMs;
  while(!bridge.status().connected){
   const status=bridge.status();
   if(status.error&&!status.transportConnected)return failure('Firefox connection: '+status.error);
   if(now()>=deadline)return failure('Firefox is open, but its browser tools did not connect. Enable the Open Browser Control extension in Firefox and check its connection to C.O.D.Y on localhost:9334, then try again.');
   await wait(Math.min(100,Math.max(1,deadline-now())));
  }
  return null;
 }catch(error){return failure('Could not prepare Firefox: '+error.message);}
}
module.exports={prepareFirefoxTask};
