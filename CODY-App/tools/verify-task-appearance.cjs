'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine})=>{
 const request=engine.request.bind(engine),emit=engine.emit,results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);let real;
 const check=(name,passed)=>{results.push({name,passed});if(!passed)throw Error(name);};
 const tasks=[{id:'appearance-whatsapp',title:'Preparing WhatsApp message',status:'Finished',preview:'Your draft is ready to review before sending.'},{id:'appearance-discord',title:'Deafening Discord audio',status:'Stopped',preview:'Stopped.'},{id:'appearance-word',title:'Writing a project brief',status:'Finished',preview:'The brief includes the overview, milestones and next steps.'}];const state={tasks,connected:true,activeCount:0};
 try{
  for(let i=0;i<150;i++){if(await evaluate('Boolean(window.CODYTasks&&window.CODYIsland?.integrationReady)'))break;await wait(100);}
  real=await request('tasks-state');engine.request=async(command,args)=>command==='tasks-state'?state:command==='task-preview'&&args.taskId.startsWith('appearance-')?{kind:'document',files:args.taskId.endsWith('word')?['Project brief.docx']:[],outputs:[]}:request(command,args);
  engine.emit=function(event,data,...args){if(event==='background-tasks'&&data!==state)return false;return emit.call(this,event,data,...args);};engine.emit('background-tasks',state);await evaluate('window.CODYTasks.open()');await wait(1700);
  check('WhatsApp task gets its own app icon despite a generic backend kind',await evaluate(`document.querySelector('[data-task-id="appearance-whatsapp"] .task-icon img')?.src.endsWith('/whatsapp.png')`));
  check('Word document gets a Word app icon',await evaluate(`document.querySelector('[data-task-id="appearance-word"] .task-icon img')?.src.endsWith('/word.png')`));
  check('Discord uses its original installed app icon',await evaluate(`document.querySelector('[data-task-id="appearance-discord"] .task-icon img')?.src.endsWith('/discord.png')`));
  check('App icons load as crisp local assets',await evaluate(`[...document.querySelectorAll('.task-icon img')].every(x=>x.complete&&x.naturalWidth>0)`));
  check('Messaging uses a chat preview instead of a document label',await evaluate(`!!document.querySelector('.task-message-bubble')&&document.querySelector('.task-message-preview .task-output-type').textContent==='WhatsApp'`));
  check('Completed cards do not waste space on empty progress bars',await evaluate(`[...document.querySelectorAll('.task-card-progress')].every(x=>x.hidden)`));
  check('Preview content fits without overlapping card actions',await evaluate(`[...document.querySelectorAll('.task-row')].every(row=>{const c=row.querySelector('.task-preview').getBoundingClientRect(),f=row.querySelector('.task-card-footer').getBoundingClientRect(),t=row.querySelector('.task-cover-caption').getBoundingClientRect();return c.bottom<f.top&&t.bottom<=c.bottom&&c.height>=67;})`));
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/task-app-cards.png'),(await win.webContents.capturePage(clip)).toPNG());
 }catch(error){results.push({name:error.stack,passed:false});}
 finally{engine.request=request;engine.emit=emit;if(real)emit.call(engine,'background-tasks',real);island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/task-app-cards-live.json'),JSON.stringify({passed:results.every(x=>x.passed),results},null,2));}
};
