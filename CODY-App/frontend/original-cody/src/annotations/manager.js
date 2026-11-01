'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {EventEmitter}=require('node:events');
const schema=require('./schema');
const coordinates=require('./coordinates');
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
class AnnotationManager extends EventEmitter{
 constructor({overlay,screen,settings={},refreshTarget,captures,now=Date.now}={}){
  super();this.overlay=overlay;this.screen=screen;this.settings=schema.settings(settings);this.refreshTarget=refreshTarget;this.now=now;this.items=new Map();this.targets=new Map();this.retries=new Map();this.serial=Promise.resolve();this.scope='gui';this.speechExpected=false;this.speaking=false;this.generation=0;this.fadeMs=180;
  this.overlay?.on?.('lost',reason=>this.clearImmediate(reason));
  this.captures=captures;
 }
 displays(){return this.screen.getAllDisplays().map(display=>({id:String(display.id),bounds:{...display.bounds},scaleFactor:display.scaleFactor||1}));}
 status(){return {settings:{...this.settings},active:[...this.items.values()].filter(item=>!item.removeAt).map(item=>({id:item.shape.id,kind:item.shape.kind,mode:item.shape.mode})),coordinateSpace:'screen-dip'};}
 observeDesktop(windows){
  if(!Array.isArray(windows))return windows;const now=this.now();
  for(const [key,ref]of this.targets)if(now-ref.at>45000)this.targets.delete(key);
  const observe=(native,reference)=>{
   if(!coordinates.validRect(native))return null;let rect;try{rect=coordinates.physicalRectToDip(this.screen,native);}catch{return null;}
   if(!this.displays().some(display=>coordinates.intersects(rect,display.bounds)))return null;
   const targetId='target-'+randomUUID();this.targets.set(targetId,{...reference,rect,at:now,scope:this.scope});
   while(this.targets.size>2048)this.targets.delete(this.targets.keys().next().value);
   return {annotationTargetId:targetId,annotationBounds:rect,annotationCoordinateSpace:'screen-dip'};
  };
  return windows.map(window=>({...window,...observe(window.bounds,{pid:window.pid,window:true,title:window.title}),controls:(window.controls||[]).map(control=>({...control,...observe(control.bounds,{pid:window.pid,name:control.name,role:control.role,automationId:control.automationId})}))}));
 }
 async resolve(kind,args,context,cache){
  if(args.space&&args.space!=='desktop-dip'){
   if(args.targetId||args.relative)throw Error('Use one coordinate reference per annotation');
   let rect;
   if(args.space.startsWith('capture-')){
    if(!this.captures)throw Error('Capture metadata is unavailable');
    const metadata=this.captures.get(args.captureId,context);rect=metadata.desktopDipRect;
    if(args.space==='capture-pixels'){
     args={...args};for(const key of ['x','toX','controlX','width'])if(args[key]!==undefined)args[key]/=metadata.modelImageWidth;
     for(const key of ['y','toY','controlY','height'])if(args[key]!==undefined)args[key]/=metadata.modelImageHeight;
     if(args.radius!==undefined)args.radius/=Math.min(metadata.modelImageWidth,metadata.modelImageHeight);
     if(args.points)args.points=args.points.map(point=>({x:point.x/metadata.modelImageWidth,y:point.y/metadata.modelImageHeight}));
    }
   }else{
    if(context.origin==='ai-chat')throw Error('For screen UI use a fresh observed targetId; do not guess normalized positions');
    rect=this.displays().find(display=>display.id===String(args.displayId))?.bounds;if(!rect)throw Error('display_not_found: requested display is absent');
   }
   for(const key of ['x','y','toX','toY','controlX','controlY','width','height','radius'])if(args[key]!==undefined&&(args[key]<0||args[key]>1))throw Error('Normalized annotation geometry must be between zero and one');
   for(const point of args.points||[])if(point.x<0||point.x>1||point.y<0||point.y>1)throw Error('Normalized path lies outside the capture');
   const {space,captureId,displayId,...geometry}=args;return coordinates.relativeGeometry(kind,geometry,rect);
  }
  if(kind==='card'&&!args.targetId){
   const display=args.displayId?this.displays().find(d=>d.id===String(args.displayId)):this.displays()[0];if(!display)throw Error('display_not_found');
   const rect=display.workArea||display.bounds;
   return {...args,x:context.origin==='ai-chat'?rect.x+24:(args.x??rect.x+24),y:context.origin==='ai-chat'?rect.y+64:(args.y??rect.y+64)};
  }
  if(context.origin==='ai-chat'&&!args.targetId)throw Error('Drawing needs a fresh annotationTargetId from desktop.inspect; do not guess screen coordinates');
  if(!args.targetId)return args;
  const target=this.targets.get(args.targetId);
  if(!target||this.now()-target.at>45000||context.origin==='ai-chat'&&target.scope!==this.scope)throw Error('Annotation target is stale. Inspect the desktop again');
  let rect=target.rect;
  if(context.origin==='ai-chat'){
   if(!this.refreshTarget)throw Error('Cannot verify the target position. Inspect the desktop again');
   const native=await this.refreshTarget(target,cache);rect=coordinates.physicalRectToDip(this.screen,native);
  }
  if(args.relative){
   if(context.origin==='ai-chat'&&!/\b(?:diagram|sketch|flowchart|chart|illustrat\w*)\b/i.test(context.humanTask||''))throw Error('Relative coordinates are for an explicitly requested diagram, not guessing UI positions');
   for(const key of ['x','y','width','height','radius','toX','toY','controlX','controlY'])if(args[key]!==undefined&&(args[key]<0||args[key]>1))throw Error('Relative diagram coordinates must be between 0 and 1');
   for(const point of args.points||[])if(point.x<0||point.x>1||point.y<0||point.y>1)throw Error('Relative path points must be between 0 and 1');
   return coordinates.relativeGeometry(kind,args,rect);
  }
  if(context.origin==='ai-chat'&&schema.GEOMETRY[kind].some(key=>key!=='text'&&key!=='fontSize'&&args[key]!==undefined))throw Error('Use the observed targetId without guessed UI coordinates');
  return coordinates.targetGeometry(kind,args,rect,this.displays());
 }
 style(args){return {color:args.color||this.settings.color,strokeWidth:args.strokeWidth||3,glowIntensity:args.glow===false?0:this.settings.glowIntensity,opacity:args.opacity??1,animationMs:args.animationMs??this.settings.animationMs,mode:args.mode||'temporary',durationMs:args.durationMs??this.settings.defaultDurationMs};}
 scene(){return [...this.items.values()].map(item=>({...item.shape,waitingForSpeech:!!item.waitingForSpeech,paused:!!item.paused,removing:!!item.removeAt}));}
 async render(signal){if(this.overlay)await this.overlay.render(this.scene(),this.displays(),signal);}
 queueRender(){
  const generation=this.generation;
  const pending=this.serial.then(()=>generation===this.generation?this.render():undefined);
  this.serial=pending.catch(error=>{if(generation===this.generation){this.emit('diagnostic',error.message);this.clearImmediate('overlay recovery');}});return this.serial;
 }
 execute(action,input={},context={origin:'gui'}){
  const args=schema.validate(action,input),generation=this.generation;
  const run=async()=>{
   if(generation!==this.generation||context.signal?.aborted)throw Error('Annotation request cancelled');
   if(action==='draw.status')return this.status();
   if(!this.settings.enabled&&!['draw.clear','draw.remove'].includes(action))throw Error('Annotations are disabled in Settings → Annotations');
   const fingerprint=createHash('sha256').update(JSON.stringify(stable({scope:context.scopeId||this.scope,origin:context.origin,action,args}))).digest('hex');
   const cached=this.retries.get(fingerprint);if(cached&&cached.ids.every(id=>this.items.has(id)&&!this.items.get(id).removeAt))return {...cached,duplicate:true,visible:cached.ids.some(id=>!this.items.get(id).waitingForSpeech),scheduled:cached.ids.some(id=>this.items.get(id).waitingForSpeech)};
   const previous=new Map(this.items),cache=new Map(),ids=[];
   const apply=async(command,clean)=>{
    if(command==='draw.batch'){for(const entry of clean.commands)await apply(entry.action,entry.args);return;}
    if(command==='draw.clear'||command==='draw.remove'){
     const selected=command==='draw.remove'?[clean.id]:clean.ids||[...this.items.keys()];
     for(const id of selected){const item=this.items.get(id);if(item){this.items.set(id,{...item,removeAt:this.now()+this.fadeMs});ids.push(id);}}return;
    }
    let supplied=clean,kind=command.slice(5),old;
    if(command==='draw.update'){
     old=this.items.get(clean.id);if(!old||old.removeAt)throw Error('Annotation does not exist');
     if(context.origin==='ai-chat'&&old.scope!==(context.scopeId||this.scope)&&old.shape.mode!=='persistent')throw Error('Annotation belongs to a different task');
     kind=old.shape.kind;supplied=schema.validate('draw.'+kind,{...old.args,...clean.changes,id:clean.id});
    }
    if(kind==='spotlight'&&!this.settings.spotlight)throw Error('Spotlight effects are disabled in Settings → Annotations');
    if(kind==='spotlight'&&!old&&[...this.items.values()].some(item=>item.shape.kind==='spotlight'&&!item.removeAt))throw Error('A spotlight is already active; update or clear it before adding another');
    if(!old&&this.items.size>=this.settings.maxConcurrent)throw Error('Maximum concurrent annotations reached; clear drawings first');
    const styleOnly=old&&!Object.keys(clean.changes).some(key=>schema.GEOMETRY[kind].includes(key)||['targetId','relative','space','displayId','captureId'].includes(key));
    const resolved=styleOnly?Object.fromEntries(schema.GEOMETRY[kind].filter(key=>old.shape[key]!==undefined).map(key=>[key,old.shape[key]])):await this.resolve(kind,supplied,context,cache);
    if(generation!==this.generation||context.signal?.aborted)throw Error('Annotation request cancelled');
    const {targetId,relative,...geometry}=resolved;const checked=schema.validate('draw.'+kind,geometry);
    const shape=coordinates.onDesktop({...checked,...this.style(supplied),kind,id:supplied.id||randomUUID()},this.displays());
    if(!old&&this.items.has(shape.id))throw Error('Annotation ID already exists; use draw.update');
    const expiresAt=shape.mode==='persistent'?Infinity:this.now()+(shape.mode==='speech'?(this.speaking?120000:this.speechExpected?60000:this.settings.defaultDurationMs):shape.durationMs);
    this.items.set(shape.id,{shape,args:supplied,scope:context.scopeId||this.scope,expiresAt,speechSeen:this.speaking,waitingForSpeech:shape.mode==='speech'&&this.speechExpected&&!this.speaking});ids.push(shape.id);
   };
   try{
    await apply(action,args);if(generation!==this.generation||context.signal?.aborted)throw Error('Annotation request cancelled');
    await this.render(context.signal);if(generation!==this.generation)throw Error('Annotation request cancelled');
    const result={accepted:true,rendered:true,visible:ids.some(id=>!this.items.get(id)?.waitingForSpeech),scheduled:ids.some(id=>this.items.get(id)?.waitingForSpeech),ids:[...new Set(ids)],coordinateSpace:'screen-dip'};
    this.retries.set(fingerprint,result);while(this.retries.size>512)this.retries.delete(this.retries.keys().next().value);this.schedule();return result;
   }catch(error){
    // Invalid batches are atomic; render failures must never leave an unknown
    // full-screen scene behind. The next request lazily recreates the overlay.
    if(generation!==this.generation)throw error;
    this.items=previous;
    if(/render|overlay|cancel|crash|timeout/i.test(error.message))this.clearImmediate('render failure');
    throw error;
   }
  };
  const pending=this.serial.then(run);this.serial=pending.catch(()=>{});return pending;
 }
 schedule(){
  clearTimeout(this.timer);const next=Math.min(...[...this.items.values()].map(item=>item.removeAt||item.expiresAt));
  if(Number.isFinite(next)){this.timer=setTimeout(()=>this.tick(),Math.max(1,next-this.now()));this.timer.unref?.();}
 }
 tick(){const pending=this.serial.then(()=>this.advance());this.serial=pending.catch(()=>{});return pending;}
 async advance(){
  const generation=this.generation,now=this.now();let changed=false;
  for(const [id,item]of this.items){if(item.removeAt&&item.removeAt<=now){this.items.delete(id);changed=true;}else if(!item.removeAt&&item.expiresAt<=now){this.items.set(id,{...item,removeAt:now+this.fadeMs});changed=true;}}
  if(changed)try{await this.render();}catch(error){if(generation===this.generation){this.clearImmediate('overlay recovery');this.emit('diagnostic',error.message);}}
  this.schedule();
 }
 clearImmediate(reason='cleared'){
  this.generation++;clearTimeout(this.timer);this.items.clear();this.targets.clear();this.retries.clear();this.speaking=false;this.overlay?.reset();this.emit('cleared',reason);
 }
 beginScope(scope,{speechExpected=false}={}){
  this.generation++;
  if(this.settings.automaticClearing){for(const [id,item]of this.items)if(item.shape.mode!=='persistent')this.items.set(id,{...item,removeAt:this.now()+this.fadeMs});void this.queueRender();}
  this.scope=scope;this.speaking=false;this.speechExpected=speechExpected;this.targets.clear();this.schedule();
 }
 finishScope(scope){
  if(this.speechExpected)return;
  for(const [id,item]of this.items)if(item.scope===scope&&item.shape.mode==='speech'&&!item.speechSeen)this.items.set(id,{...item,expiresAt:this.now()+this.settings.defaultDurationMs});this.schedule();
 }
 speech(phase,scopeId){
  const owner=scopeId||this.scope,current=owner===this.scope;
  if(!current&&![...this.items.values()].some(item=>item.scope===owner&&item.shape.mode==='speech'&&!item.removeAt))return;
  if(phase==='paused'||phase==='resumed'){
   for(const [id,item]of this.items)if(item.scope===owner&&item.shape.mode==='speech'&&!item.removeAt){
    const paused=phase==='paused';this.items.set(id,{...item,paused,expiresAt:paused?Infinity:this.now()+(item.remainingMs||120000),remainingMs:paused?Math.max(1,item.expiresAt-this.now()):null});
   }
   void this.queueRender();this.schedule();return;
  }
  if(phase==='playing'){
   if(current)this.speaking=true;for(const [id,item]of this.items)if(item.scope===owner&&item.shape.mode==='speech'&&!item.removeAt)this.items.set(id,{...item,waitingForSpeech:false,paused:false,speechSeen:true,expiresAt:this.now()+120000});
   void this.queueRender();
  }else{
   if(current)this.speaking=false;
   for(const [id,item]of this.items)if(item.scope===owner&&item.shape.mode==='speech'&&(phase==='cancelled'||item.speechSeen)&&this.settings.speechLinkedRemoval)this.items.set(id,{...item,removeAt:this.now()+this.fadeMs});
   void this.queueRender();
  }this.schedule();
 }
 configure(patch){
  this.settings=schema.settings(patch,this.settings);
  if(!this.settings.enabled||this.items.size>this.settings.maxConcurrent)this.clearImmediate('annotations disabled or limit changed');
  else{for(const [id,item]of this.items)this.items.set(id,{...item,shape:{...item.shape,...this.style(item.args)},...(item.shape.kind==='spotlight'&&!this.settings.spotlight?{removeAt:this.now()+this.fadeMs}:{})});void this.queueRender();this.schedule();}
  return this.status();
 }
 close(){this.clearImmediate('application exit');this.overlay?.close();}
}
module.exports={AnnotationManager};
