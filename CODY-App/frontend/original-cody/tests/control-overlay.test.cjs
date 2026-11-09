'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {ControlOverlay}=require('../src/control-overlay');
function setup({cursorColor,nativeOrder=false}={}){
  const created=[],engine=new EventEmitter(),screen=new EventEmitter();let accent='#47A8FF';const registrations=[];if(nativeOrder){engine.connected=true;engine.request=async(command,args)=>{registrations.push({command,args});return {registered:args.handles.length,eventDriven:true};};}
  screen.displays=[{id:1,bounds:{x:0,y:0,width:1000,height:600},scaleFactor:2},{id:2,bounds:{x:-800,y:0,width:800,height:600},scaleFactor:1}];screen.getAllDisplays=()=>screen.displays;
  screen.screenToDipPoint=point=>({x:point.x/2,y:point.y/2});
  class Window extends EventEmitter{
    constructor(options){super();this.options=options;this.handle=created.length+1;created.push(this);this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.sent=[];this.webContents.send=(name,data)=>this.sent.push({name,data});}
    getNativeWindowHandle(){const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(this.handle));return b;}
    moveTop(){this.raises=(this.raises||0)+1;}setIgnoreMouseEvents(value){this.clickThrough=value;}setAlwaysOnTop(value){this.topmost=value;}setContentProtection(value){this.excluded=value;}setBounds(value){this.bounds=value;}
    loadFile(){return Promise.resolve().then(()=>this.webContents.emit('did-finish-load'));}isDestroyed(){return Boolean(this.destroyed);}isVisible(){return Boolean(this.visible);}showInactive(){this.visible=true;this.inactive=true;}destroy(){this.destroyed=true;this.emit('closed');}
  }
  return {created,engine,screen,registrations,setAccent:value=>accent=value,setCursorColor:value=>cursorColor=value,overlay:new ControlOverlay({BrowserWindow:Window,screen,engine,getAccent:()=>accent,getCursorColor:()=>cursorColor||accent})};
}
test('drive visuals are inactive by default and native start creates click-through recordable overlays on each display',async()=>{
  const {overlay,engine,created}=setup();assert.equal(created.length,0);
  engine.emit('computer-control',{active:true,acting:true,x:400,y:200});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,2);for(const win of created){assert.equal(win.clickThrough,true);assert.equal(win.excluded,false);assert.equal(win.inactive,true);assert.equal(win.options.focusable,false);}
  assert.deepEqual(created[0].sent.at(-1).data.cursor,{x:200,y:100});assert.equal(created[1].sent.at(-1).data.cursor,null);
  engine.emit('computer-control',{active:false});assert.equal(overlay.windows.size,0);assert.ok(created.every(win=>win.destroyed));overlay.close();
});
test('agent launches use a coloured Cody mascot flight to the island on every monitor',async()=>{
 const {overlay,engine,created}=setup();engine.emit('agent-launch',{id:'new-task',x:400,y:200});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(created.length,2);const flight=created[0].sent.at(-1).data.agentFlights[0];assert.deepEqual(flight.from,{x:200,y:100});assert.deepEqual(flight.to,{x:500,y:16});assert.equal(flight.filter,'hue-rotate(60deg)');
 engine.emit('agent-launch',{id:'new-task',x:400,y:200});assert.equal(overlay.agentFlights.length,1);overlay.close();assert.equal(engine.listenerCount('agent-launch'),0);assert.ok(created.every(win=>win.destroyed));
});
test('accent changes recolour existing windows and monitor changes rebuild geometry',async()=>{
  const {overlay,engine,created,screen,setAccent}=setup();engine.emit('computer-control',{active:true,x:10,y:10});await new Promise(resolve=>setImmediate(resolve));
  setAccent('#F377BC');overlay.render();assert.equal(created[0].sent.at(-1).data.accent,'#F377BC');assert.equal(created.length,2);
  setAccent('invalid');overlay.render();assert.equal(created[0].sent.at(-1).data.accent,'#47A8FF');
  screen.displays.pop();screen.emit('display-removed');await new Promise(resolve=>setImmediate(resolve));assert.equal(overlay.windows.size,1);assert.ok(created[0].destroyed);overlay.close();
});
test('disconnect and application close clear visuals and detach listeners',async()=>{
  const {overlay,engine,created,screen}=setup();engine.emit('computer-control',{active:true,x:0,y:0});await new Promise(resolve=>setImmediate(resolve));
  engine.emit('offline');assert.ok(created.every(win=>win.destroyed));overlay.close();assert.equal(engine.listenerCount('computer-control'),0);assert.equal(screen.listenerCount('display-added'),0);
});
test('voice cursor morphs without the computer-control glow and restores pointer while acting',async()=>{
 const {overlay,engine,created}=setup();engine.emit('cursor-state',{visible:true,phase:'Listening',level:.4,x:400,y:200});await new Promise(resolve=>setImmediate(resolve));assert.equal(created[0].sent.at(-1).data.phase,'Listening');assert.equal(created[0].sent.at(-1).data.glow,false);assert.equal(created[0].sent.at(-1).data.level,.4);
 engine.emit('cursor-state',{visible:true,phase:'Processing',x:400,y:200});assert.equal(created[0].sent.at(-1).data.phase,'Processing');engine.emit('computer-control',{active:true,acting:true,x:500,y:300});assert.equal(created[0].sent.at(-1).data.phase,'Idle');assert.equal(created[0].sent.at(-1).data.glow,true);engine.emit('offline');assert.equal(overlay.windows.size,0);overlay.close();assert.equal(engine.listenerCount('cursor-state'),0);
});
test('job messages reach the custom cursor bubble and clear on the next native state',async()=>{
 const {overlay,engine,created}=setup();engine.emit('cursor-state',{visible:true,phase:'Idle',message:'Finished the report.',x:400,y:200});await new Promise(resolve=>setImmediate(resolve));assert.equal(created[0].sent.at(-1).data.message,'Finished the report.');
 engine.emit('cursor-state',{visible:true,phase:'Idle',message:null,x:400,y:200});assert.equal(created[0].sent.at(-1).data.message,'');overlay.close();
});
test('cursor colour can be selected independently and falls back to the appearance accent',async()=>{const {overlay,engine,created,setCursorColor}=setup({cursorColor:'#4ADE80'});engine.emit('computer-control',{active:true,acting:true,x:400,y:200});await new Promise(resolve=>setImmediate(resolve));assert.equal(created[0].sent.at(-1).data.cursorColor,'#4ADE80');assert.equal(created[0].sent.at(-1).data.accent,'#47A8FF');setCursorColor('accent');overlay.render();assert.equal(created[0].sent.at(-1).data.cursorColor,'#47A8FF');setCursorColor('invalid');overlay.render();assert.equal(created[0].sent.at(-1).data.cursorColor,'#47A8FF');overlay.close();});

 test('guided outlines render without a floating cursor and clear when the native target ends',async()=>{
  const {overlay,engine,created}=setup();overlay.getCursorOptions=()=>({hideFloatingCursor:true});
  engine.emit('cursor-state',{visible:false,target:{x:530,y:144,radius:56,frame:{x:496,y:122,width:68,height:45},label:'Click Add'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,2);const state=created[0].sent.at(-1).data;
  assert.deepEqual(state.target,{x:248,y:61,width:34,height:22.5,rounded:false,label:'Click Add'});assert.equal(state.cursor,null);
  overlay.keepOnTop();for(const win of created){assert.equal(win.topmost,true);assert.equal(win.raises,1);assert.equal(win.inactive,true);}
  engine.emit('cursor-state',{visible:false,target:null});assert.equal(overlay.windows.size,0);overlay.close();
 });
 test('guided rings use monitor scale and negative monitor origins and vanish on disconnect',async()=>{
  const {overlay,engine,screen,created}=setup();screen.screenToDipPoint=p=>p;
  engine.emit('cursor-state',{visible:false,target:{x:-400,y:100,radius:30,label:'Add'}});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(created[1].sent.at(-1).data.target,{x:370,y:70,width:60,height:60,rounded:true,label:'Add'});
  engine.emit('offline');assert.equal(overlay.windows.size,0);overlay.close();
 });

test('computer control keeps a pointer throughout listening, thinking, speaking and action pauses',async()=>{
 const {overlay,engine,created}=setup();engine.emit('computer-control',{active:true,acting:false,x:500,y:300});await new Promise(resolve=>setImmediate(resolve));
 for(const phase of ['Listening','Processing','Responding','Idle']){engine.emit('cursor-state',{visible:true,phase,x:400,y:200});const state=created[0].sent.at(-1).data;assert.equal(state.phase,'Idle');assert.equal(state.pointerOnly,true);assert.equal(state.glow,true);}
 engine.emit('computer-control',{active:false});engine.emit('cursor-state',{visible:true,phase:'Processing',x:400,y:200});assert.equal(created[0].sent.at(-1).data.phase,'Processing');assert.equal(created[0].sent.at(-1).data.pointerOnly,false);overlay.close();
});

test('native ordering owns visible overlays and avoids periodic glow raises over the island',async()=>{const f=setup({nativeOrder:true});f.engine.emit('computer-control',{active:true,x:1,y:1});await new Promise(r=>setImmediate(r));assert.equal(f.overlay.nativeOrderReady,true);assert.equal(f.registrations.at(-1).command,'control-overlay-order');assert.deepEqual(f.registrations.at(-1).args.handles,['1','2']);const before=f.created.map(w=>w.raises||0);f.overlay.lastRaisedAt=0;f.overlay.keepOnTop();assert.deepEqual(f.created.map(w=>w.raises||0),before);f.engine.emit('computer-control',{active:false});await new Promise(r=>setImmediate(r));assert.deepEqual(f.registrations.at(-1).args.handles,[]);f.overlay.close();});
test('Electron recovery still raises click-through overlays if native ordering fails',async()=>{const f=setup({nativeOrder:true});f.engine.request=async()=>{throw Error('Native ordering unavailable');};f.engine.emit('computer-control',{active:true,x:1,y:1});await new Promise(r=>setImmediate(r));assert.equal(f.overlay.nativeOrderReady,false);f.overlay.lastRaisedAt=0;f.overlay.keepOnTop();assert.ok(f.created.every(w=>w.raises>0&&w.clickThrough&&w.options.focusable===false));f.overlay.close();});
