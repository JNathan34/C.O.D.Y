'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,controller,engine,pendingApprovals})=>{
  const results=[],evaluate=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),fixtures=[];
  const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
  async function until(predicate){const deadline=Date.now()+30000;while(Date.now()<deadline){if(await predicate())return;await wait(100);}throw Error('Approval UI check timed out');}
  function fixture(summary){const before=new Set(pendingApprovals.keys()),promise=controller.confirm({action:'UI verification only',summary});const id=[...pendingApprovals.keys()].find(key=>!before.has(key));fixtures.push(id);return {id,promise};}
  async function shown(id){await until(()=>evaluate(`!document.getElementById('core-approval').hidden&&document.getElementById('core-approval').dataset.approvalId===${JSON.stringify(id)}`));await wait(200);}
  async function capture(){const bounds=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return {x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/island-computer-approval.png'),(await win.webContents.capturePage(bounds)).toPNG());}
  try{
    await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));
    const requests=await engine.request('approval-state');check('real native approval endpoint responds',Array.isArray(requests));
    if(requests.length){
      island.show();await shown(requests[0].id);await wait(600);
      const layout=await evaluate(`(()=>{const card=document.getElementById('core-approval'),r=card.getBoundingClientRect(),i=document.getElementById('island').getBoundingClientRect();return {expanded:document.body.classList.contains('panel-open'),insideIsland:r.left>=i.left&&r.right<=i.right&&r.bottom<=i.bottom,allowVisible:document.getElementById('core-approval-allow').getBoundingClientRect().width>0,denyVisible:document.getElementById('core-approval-deny').getBoundingClientRect().width>0,actionShown:Boolean(document.getElementById('core-approval-command').textContent)};})()`);
      check('real waiting computer-use request is visible inside the Island',Object.values(layout).every(Boolean),layout);await capture();
      results.push({name:'real pending requests left unanswered; fixture clicks skipped',passed:true,count:requests.length});return;
    }
    if(pendingApprovals.size){results.push({name:'UI fixtures skipped to leave real waiting approvals untouched',passed:true});return;}
    island.collapse();
    const first=fixture('Test request: inspect the current window. No computer action will run.');await shown(first.id);await wait(600);
    const layout=await evaluate(`(()=>{const card=document.getElementById('core-approval'),deny=document.getElementById('core-approval-deny'),allow=document.getElementById('core-approval-allow'),r=card.getBoundingClientRect(),i=document.getElementById('island').getBoundingClientRect(),a=allow.getBoundingClientRect();return {expanded:document.body.classList.contains('panel-open'),insideIsland:r.left>=i.left&&r.right<=i.right&&r.bottom<=i.bottom,buttonsVisible:a.width>0&&a.bottom<=i.bottom,denyFocused:document.activeElement===deny,reasonVisible:document.getElementById('core-approval-command').textContent.includes('No computer action')};})()`);
    check('request expands the Island with visible action, Deny and Allow once',Object.values(layout).every(Boolean),layout);
    await capture();
    const second=fixture('Second test request — no computer action.');await shown(first.id);
    check('multiple requests queue instead of replacing the first',await evaluate(`document.getElementById('core-approval-count').textContent==='2 requests waiting'`));
    await evaluate(`document.getElementById('core-approval-deny').click()`);check('Deny returns false for only the first request',await first.promise===false&&pendingApprovals.has(second.id));
    await shown(second.id);await evaluate(`document.getElementById('core-approval-allow').click();document.getElementById('core-approval-allow').click()`);
    check('Allow once resolves only the second request',await second.promise===true&&!pendingApprovals.has(second.id));
    await until(()=>evaluate(`document.getElementById('core-approval').hidden`));check('answered cards disappear',true);
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
  finally{
    for(const id of fixtures){const request=pendingApprovals.get(id);if(request){pendingApprovals.delete(id);request.resolve(false);win.webContents.send('approval-resolved',id);}}
    fs.writeFileSync(path.resolve(__dirname,'../reports/island-approvals-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));
  }
};
