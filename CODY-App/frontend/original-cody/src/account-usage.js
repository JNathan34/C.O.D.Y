'use strict';
function codexUsage(payload={},account={}){
  const limit=payload.rateLimitsByLimitId?.codex||payload.rateLimits;
  const windows=[];
  for(const name of ['primary','secondary']){
    const value=limit?.[name];if(!value||!Number.isFinite(value.usedPercent)||value.usedPercent<0)continue;
    const minutes=value.windowDurationMins;
    const label=minutes===10080?'Weekly limit':Number.isFinite(minutes)&&minutes>0?(minutes%60===0?`${minutes/60}-hour limit`:`${minutes}-minute limit`):'Usage limit';
    windows.push({label,usedPercent:value.usedPercent,remainingPercent:Math.max(0,100-value.usedPercent),durationMins:minutes??null,resetsAt:Number.isFinite(value.resetsAt)?new Date(value.resetsAt*1000).toISOString():null});
  }
  windows.sort((a,b)=>(a.durationMins??Infinity)-(b.durationMins??Infinity));
  return {signedIn:true,available:windows.length>0,windows,plan:limit?.planType||account.planType||null,updatedAt:new Date().toISOString(),error:windows.length?null:'Codex has not returned usage limits for this account.'};
}
async function readCodexUsage(client){
  await client.start();const result=await client.account(),account=result.account;
  if(!account)return {available:false,signedIn:false,windows:[],error:'Connect ChatGPT Codex to see your usage.'};
  if(account.type!=='chatgpt')return {available:false,signedIn:true,windows:[],error:'Usage limits require a ChatGPT account connection.'};
  return codexUsage(await client.rateLimits(),account);
}
module.exports={codexUsage,readCodexUsage};
