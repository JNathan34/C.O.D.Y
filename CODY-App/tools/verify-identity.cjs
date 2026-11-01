'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,engine,island})=>{
 const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 try{
  const end=Date.now()+45000;while(Date.now()<end&&!await win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)'))await wait(100);
  const identity=await engine.request('identity-state');
  check('engine loads the editable C.O.D.Y. identity and pronunciation prompt',identity.displayName==='C.O.D.Y.'&&identity.spokenName==='Cody'&&identity.instructions.includes('pronounced Cody')&&fs.existsSync(identity.promptPath));
  check('fixed speech uses Cody rather than the dotted acronym',identity.speechExample==='Cody is ready.');
  check('background helpers receive one copy of the same identity instructions',(identity.backgroundInstructions.match(/# C\.O\.D\.Y\. identity and pronunciation/g)||[]).length===1&&identity.backgroundInstructions.includes(identity.instructions));
  const before=(await engine.request('tasks-state')).tasks.map(task=>task.id);
  const drive=await engine.request('drive-state');let status=await engine.refresh();
  for(let attempt=0;attempt<10&&(!status.signedIn||status.state!=='Idle')&&!drive.active;attempt++){await wait(1000);status=await engine.refresh();}
  if(status.signedIn&&status.state==='Idle'&&!drive.active){
   await engine.request('fresh');
   const audioBefore=(await engine.refresh()).audioPlaybackStarts;
   const answer=await engine.request('submit',{turn:'CODY-identity-verification',text:'What is your assistant name? Reply in one short sentence with your own name, not my name.',speak:true});
   const after=await engine.refresh();
   check('a real HeyClicky conversation identifies the assistant as Cody',/\bcody\b|c\.?o\.?d\.?y/i.test(answer.text)&&!/(?:i(?:[’']m| am)|my name is)\s+(?:hey\s*)?clicky/i.test(answer.text),{response:answer.text,audioPlaybackStarts:after.audioPlaybackStarts-audioBefore});
   check('the identity reply uses native speech playback',after.audioPlaybackStarts>audioBefore);
   check('the simple identity reply does not create an agent job',(await engine.request('tasks-state')).tasks.every(task=>before.includes(task.id)));
   await engine.request('fresh');
  }else results.push({name:'live introduction skipped while signed out or the engine is busy',passed:true,detail:{signedIn:status.signedIn,state:status.state,computerControl:drive.active}});
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/identity-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));}
};
