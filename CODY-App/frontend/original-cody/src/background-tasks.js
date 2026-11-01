'use strict';
const ACTIVE=new Set(['Starting','Running','WaitingForUser']);
function taskState(value,connected=true){
 const tasks=Array.isArray(value?.tasks)?value.tasks.filter(task=>task&&typeof task.id==='string'&&task.id.length<=200&&['Starting','Running','WaitingForUser','Finished','Failed','Stopped'].includes(task.status)).map(task=>({id:task.id,title:String(task.title||'Background task').slice(0,240),status:task.status,statusLabel:typeof task.statusLabel==='string'?task.statusLabel.slice(0,40):undefined,progress:String(task.progress||'').slice(0,1600),startedAt:task.startedAt,turn:typeof task.turn==='string'?task.turn:undefined,requiresApproval:task.requiresApproval===true})):[];
 for(const task of tasks){const original=value.tasks.find(item=>item.id===task.id);task.preview=String(original.preview||'').slice(0,1200);task.stepsTotal=Number.isSafeInteger(original.stepsTotal)?Math.max(0,Math.min(1000,original.stepsTotal)):0;task.stepsDone=Number.isSafeInteger(original.stepsDone)?Math.max(0,Math.min(task.stepsTotal,original.stepsDone)):0;}
 return {connected,tasks,activeCount:connected?tasks.filter(task=>ACTIVE.has(task.status)).length:0};
}
module.exports={ACTIVE,taskState};
