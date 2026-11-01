'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,engine,store,island})=>{
 const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code),request=engine.request.bind(engine),emit=engine.emit;
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const until=async predicate=>{const end=Date.now()+45000;while(Date.now()<end){if(await predicate())return;await wait(100);}throw Error('Tasks UI timed out');};
 const fixtures=[{id:'CODY-UI-Fixture-work',title:'Research bicycle parts',status:'Running',progress:'Comparing sources',startedAt:new Date().toISOString()},{id:'CODY-UI-Fixture-completed',title:'Organise the test files',status:'Finished',progress:'Finished',startedAt:new Date().toISOString()}],actions=[];
 let real;
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady&&window.CODYTasks)'));
  real=await request('tasks-state');check('native task endpoint returns actual tasks',Array.isArray(real.tasks),{count:real.tasks.length});
  if((await request('drive-state')).active||(await request('approval-state')).length){results.push({name:'visual fixture skipped while real computer control needs attention',passed:true});return;}
  engine.request=async(command,args)=>{if(command==='tasks-state')return {tasks:fixtures};if(command==='task-detail'&&args.taskId.startsWith('CODY-UI-Fixture-'))return {id:args.taskId,status:fixtures.find(task=>task.id===args.taskId)?.status,progress:'Comparing sources',response:'A useful bicycle report will appear here.\n\nThe frame, wheels and chain are being compared.',question:''};if(command==='task-action'&&args.taskId.startsWith('CODY-UI-Fixture-')){actions.push(args);if(args.action==='stop')fixtures.find(task=>task.id===args.taskId).status='Stopped';return {accepted:true};}return request(command,args);};
  const fixtureState={tasks:fixtures};engine.emit=function(event,data,...args){if(event==='background-tasks'&&data!==fixtureState)return false;return emit.call(this,event,data,...args);};
  engine.emit('background-tasks',fixtureState);island.showCompact();await wait(600);
  check('active background task is visible in the compact Island',await evaluate(`document.body.classList.contains('task-layout')&&document.getElementById('island-info-text').textContent==='Research bicycle parts'`),await evaluate(`({classes:document.body.className,text:document.getElementById('island-info-text').textContent,count:window.CODYTasks.snapshot().activeCount})`));
  await evaluate(`window.CODYTasks.open()`);await until(()=>evaluate(`document.querySelector('.task-open')!==null`));await evaluate(`document.querySelector('.task-open').click()`);await until(()=>evaluate(`document.body.classList.contains('tasks-open')&&document.getElementById('task-response').textContent.includes('bicycle report')`));
  check('tasks view shows live work and completed work',await evaluate(`document.querySelectorAll('.task-row').length===2&&document.getElementById('task-count').textContent==='1'`));
  await wait(850);check('task panel is visibly expanded',await evaluate(`document.getElementById('island').getBoundingClientRect().height>300&&document.getElementById('view-tasks').classList.contains('is-current')`));
  const bounds=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return {x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);
  fs.writeFileSync(path.resolve(__dirname,'../reports/island-background-tasks.png'),(await win.webContents.capturePage(bounds)).toPNG());
  await evaluate(`document.getElementById('task-message').value='Use a short report';document.getElementById('task-message-form').requestSubmit()`);await until(()=>actions.length===1);
  check('follow-up instruction targets the selected fixture only',actions[0].taskId==='CODY-UI-Fixture-work'&&actions[0].action==='message'&&actions[0].text==='Use a short report');
  await until(()=>evaluate(`!document.getElementById('task-stop').disabled`));await evaluate(`document.getElementById('task-stop').click()`);await until(()=>actions.length===2);
  check('stop targets only the selected fixture',actions[1].taskId==='CODY-UI-Fixture-work'&&actions[1].action==='stop');
  await until(()=>evaluate(`document.getElementById('task-count').hidden`));
  check('completed/stopped tasks no longer show as running',await evaluate(`!document.body.classList.contains('task-layout')`));
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{engine.request=request;engine.emit=emit;if(real)engine.emit('background-tasks',await request('tasks-state').catch(()=>real));await evaluate(`window.CODYIsland.setActiveView('chat')`).catch(()=>{});island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/background-tasks-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));}
};
