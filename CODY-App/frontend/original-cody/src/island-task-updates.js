'use strict';

const {ACTIVE}=require('./background-tasks');
const line=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,180):'';
const terminal={Finished:['Task finished','check'],Failed:['Task failed','circle-alert'],Stopped:['Task stopped','square']};

class IslandTaskUpdates {
  constructor(onChange,{linger=12000}={}){
    Object.assign(this,{onChange,linger});
    this.tasks=new Map();
    this.approvals=new Map();
    this.current=null;
  }
  setEnabled(enabled){
    this.enabled=enabled;
    if(!enabled){clearTimeout(this.timer);this.recent=null;}
    this.publish();
  }
  progress(id,text,detail){
    if(!id)return;
    this.foreground={id,kind:'progress',text:line(text)||'Working…',detail:line(detail),icon:'clock',target:'chat'};
    this.publish();
  }
  drive(value){
    this.control=value?.active?{kind:'progress',text:'Controlling your PC',detail:line(value.status),icon:'mouse-pointer-2',target:'chat'}:null;
    this.publish();
  }
  finish(id,{error,cancelled,answered,detail}={}){
    if(this.foreground?.id===id)this.foreground=null;
    if(error||cancelled||answered){
      const [text,icon]=cancelled?['Request stopped','square']:error?['Request failed','circle-alert']:['Reply ready','check'];
      this.remember({kind:error||cancelled?'outcome':'reply',text,detail:line(detail||error)||'Open chat',icon,target:'chat'});
    }
    this.publish();
  }
  updateTasks(state){
    if(!state.connected){this.tasksOnline=false;this.publish();return;}
    const next=new Map(state.tasks.map(task=>[task.id,task]));
    const completed=this.tasksOnline?[...next.values()].filter(task=>Object.hasOwn(terminal,task.status)&&ACTIVE.has(this.tasks.get(task.id)?.status)):[];
    this.tasks=next;
    this.tasksOnline=true;
    if(completed.length){
      const task=completed[0], [text,icon]=terminal[task.status];
      this.remember({kind:'outcome',text:completed.length===1?text:`${completed.length} tasks ended`,detail:line(task.title),icon,target:'tasks',taskId:task.id});
    }
    this.publish();
  }
  approval(source,requests){
    if(requests.length)this.approvals.set(source,requests);
    else this.approvals.delete(source);
    this.publish();
  }
  remember(card){
    if(!this.enabled||(this.recent?.target==='tasks'&&card.kind==='reply'))return;
    this.recent=card;
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.recent=null;this.publish();},this.linger);
    this.timer.unref?.();
  }
  card(){
    if(!this.enabled)return null;
    const approvals=[...this.approvals.values()].flat();
    if(approvals.length)return {kind:'attention',text:'Approval needed',detail:line(approvals[0].reason)||'Review request',icon:'shield-check',target:'approval'};
    const active=this.tasksOnline?[...this.tasks.values()].filter(task=>ACTIVE.has(task.status)):[];
    const waiting=active.find(task=>task.status==='WaitingForUser');
    if(waiting)return {kind:'attention',text:waiting.requiresApproval?'Approval needed':'Needs your input',detail:line(waiting.progress)||line(waiting.title),icon:'circle-help',target:'tasks',taskId:waiting.id};
    if(this.control||this.foreground)return this.control||this.foreground;
    if(this.recent?.kind==='outcome')return this.recent;
    const task=active[0];
    if(task)return {kind:'progress',text:active.length>1?`${active.length} tasks working`:line(task.title),detail:line(task.progress)||(task.status==='Starting'?'Starting…':'Working in background'),icon:'clock',target:'tasks',taskId:task.id};
    return this.recent||null;
  }
  publish(){
    const next=this.card();
    if(JSON.stringify(next)===JSON.stringify(this.current))return;
    this.current=next;
    this.onChange(next);
  }
  close(){clearTimeout(this.timer);}
}

module.exports={IslandTaskUpdates};
