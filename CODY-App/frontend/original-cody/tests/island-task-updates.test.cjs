'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {IslandTaskUpdates}=require('../src/island-task-updates');

test('approval stays visible through progress and gives way to the finished task',t=>{
  const cards=[];
  const updates=new IslandTaskUpdates(card=>cards.push(card));
  t.after(()=>updates.close());
  updates.setEnabled(true);
  const task={id:'slides',title:'Build the slide deck',status:'Running',progress:'Writing the outline'};
  updates.updateTasks({connected:true,tasks:[task]});
  assert.equal(cards.at(-1).detail,'Writing the outline');
  updates.approval('native',[{reason:'Allow C.O.D.Y. to save the slides?'}]);
  assert.equal(cards.at(-1).text,'Approval needed');
  updates.updateTasks({connected:true,tasks:[{...task,status:'Finished'}]});
  assert.equal(cards.at(-1).text,'Approval needed');
  updates.approval('native',[]);
  assert.equal(cards.at(-1).text,'Task finished');
  assert.equal(cards.at(-1).taskId,'slides');
});

test('setting hides live updates and avoids replaying past results',t=>{
  const updates=new IslandTaskUpdates(()=>{});
  t.after(()=>updates.close());
  updates.setEnabled(true);
  updates.progress('turn','Reading file…');
  assert.equal(updates.current.text,'Reading file…');
  updates.setEnabled(false);
  assert.equal(updates.current,null);
  updates.finish('turn',{answered:true});
  updates.setEnabled(true);
  updates.updateTasks({connected:true,tasks:[{id:'old',status:'Finished'}]});
  assert.equal(updates.current,null);
  updates.progress('next','Working…');
  updates.finish('next',{cancelled:true});
  assert.equal(updates.current.text,'Request stopped');
});
