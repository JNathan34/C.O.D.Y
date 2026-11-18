'use strict';
(function(root,factory){
 const helpers=factory();
 if(typeof module==='object'&&module.exports)module.exports=helpers;
 else root.CODYTaskCardState=helpers;
})(typeof window==='object'?window:globalThis,()=>{
 const active=new Set(['Starting','Running','WaitingForUser']);
 function summary(task){
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,160);
  if(task.status==='Failed')return clean(task.failure||task.error||task.progress||task.preview)||
    'Task failed. Open details to see what happened and try again.';
  if(task.status==='Stopped')return clean(task.progress||task.preview)||
    'This task was stopped. Open details to pick up where you left off.';
  if(task.status==='Finished')return clean(task.preview||task.progress)||
    'Task completed. Open the result or review its details.';
  return clean(task.preview||task.progress)||
    (active.has(task.status)?'Cody is working on this…':'Open details to view this task.');
 }
 function statusLabel(task,connected=true){
  if(!connected)return 'Offline';
  return task.statusLabel||({Starting:'Starting',Running:'Working on it',WaitingForUser:'Needs your input',Finished:'Completed',Failed:'Failed',Stopped:'Stopped'})[task.status]||task.status;
 }
 return Object.freeze({summary,statusLabel});
});
