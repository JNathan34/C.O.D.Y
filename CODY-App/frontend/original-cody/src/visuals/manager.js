'use strict';
const {EventEmitter}=require('node:events');
const schema=require('./schema');
const {compose}=require('./procedural');
class SceneManager extends EventEmitter{
 constructor({adapter,screen,assets,settings={}}){
  super();Object.assign(this,{adapter,screen,assets});this.settings=schema.settings(settings);this.models=new Map();this.selected=null;this.scope='gui';this.generation=0;this.serial=Promise.resolve();this.name='Desktop scene';this.viewport=null;this.speechPhase='finished';this.paused=false;
  adapter.on?.('changed',change=>this.interaction(change));adapter.on?.('lost',reason=>this.clearImmediate(reason));
 }
 displays(){return this.screen.getAllDisplays().map(d=>({id:String(d.id),bounds:{...d.bounds},workArea:{...(d.workArea||d.bounds)},scaleFactor:d.scaleFactor}));}
 placement(args={}){
  const displays=this.displays(),displayId=args.displayId||this.viewport?.displayId||this.settings.displayId;
  const primary=displays.find(d=>d.id===String(this.screen.getPrimaryDisplay().id));
  const display=(displayId==='primary'?primary:displays.find(d=>d.id===String(displayId)))||(!args.displayId?primary:null);
  if(!display)throw Error('display_not_found: use a display ID from scene.status');const area=display.workArea;
  const width=Math.min(Math.round(args.width||this.viewport?.width||this.settings.width),area.width),height=Math.min(Math.round(args.height||this.viewport?.height||this.settings.height),area.height);
  const x=Math.round(args.x??(args.displayId?area.x+area.width-width-Math.min(24,area.width-width):this.viewport?.x??area.x+area.width-width-Math.min(24,area.width-width)));
  const y=Math.round(args.y??(args.displayId?area.y+Math.min(100,Math.max(0,area.height-height)):this.viewport?.y??area.y+Math.min(100,Math.max(0,area.height-height))));
  if(x<area.x||y<area.y||x+width>area.x+area.width||y+height>area.y+area.height)throw Error('validation_failed: viewport must fit the selected display work area');
  return {displayId:display.id,x,y,width,height};
 }
 status(){return {enabled:this.settings.enabled,name:this.name,selected:this.selected,viewport:this.viewport,displays:this.displays(),models:[...this.models.values()].map(({asset,animation,...model})=>({...model,...(asset?{assetId:asset.assetId}:{}),...(animation?{animation:{property:animation.property,durationMs:animation.durationMs,start:animation.start}}:{}),parts:model.parts?.map(part=>({...part,id:model.id+':'+part.id}))})),assets:this.assets?.list()||[],generation:{procedural:true,presets:['computer','robot','tree'],detailed:{available:false,reason:'No approved detailed text/image-to-3D provider is configured.'}}};}
 target(id,models=this.models){
  const [rootId,partId]=id.split(':'),root=models.get(rootId);if(!root)throw Error('target_not_found: model ID was not found');
  const target=partId?root.parts?.find(part=>part.id===partId):root;if(!target)throw Error('target_not_found: model part was not found');return {root,target};
 }
 snapshot(){return {models:[...this.models.values()],selected:this.selected,viewport:this.viewport,name:this.name,animations:this.settings.animations,speechPhase:this.speechPhase,scopeId:this.scope};}
 async render(signal){
  if(!this.models.size){this.adapter.reset();return {rendered:true,meshes:0};}
  if(!this.viewport)this.viewport=this.placement();
  return this.adapter.render(this.snapshot(),signal);
 }
 execute(action,input={},context={origin:'gui'}){
  const args=schema.validate(action,input),generation=this.generation;
  const work=async()=>{
   if(generation!==this.generation||context.signal?.aborted||context.origin==='ai-chat'&&context.scopeId!==this.scope)throw Error('stale_turn: scene command was cancelled');
   if(action==='scene.status')return this.status();
   if(!this.settings.enabled&&action!=='scene.clear')throw Error('permission_denied: 3D visuals are disabled');
   if(action==='model.generateDetailed')return {available:false,executed:false,reason:this.status().generation.detailed.reason};
   const previous={models:this.models,selected:this.selected,viewport:this.viewport,name:this.name};
   this.models=new Map([...this.models].map(([id,model])=>[id,structuredClone(model)]));
   let targetId=args.id;
   try{
    if(action==='scene.clear'){this.models.clear();this.selected=null;}
    else if(action==='scene.create'){if(args.name)this.name=args.name;this.viewport=this.placement(args);}
    else if(action==='scene.move')this.viewport=this.placement(args);
    else if(['model.createPrimitive','model.create','model.generate','model.load'].includes(action)){
     if(this.models.has(args.id))throw Error('validation_failed: model ID already exists; mutate it by ID instead');
     if(this.models.size>=this.settings.maxModels)throw Error('validation_failed: model count limit reached');
     let model={...args};
     if(action==='model.generate'){const parts=compose(args.preset).map(part=>({...part,...(args.color?{color:args.color}:{}),...(args.material?{material:args.material}:{})}));model=schema.validate('model.create',{id:args.id,label:args.label||args.preset,position:args.position,rotation:args.rotation,scale:args.scale,parts});model.proceduralPreset=args.preset;}
     if(action==='model.load')model.asset=this.assets.load(args.assetId);
     const count=[...this.models.values(),model].reduce((n,item)=>n+(item.parts?.length||item.asset?.meshes||1),0);
     if(count>this.settings.maxParts)throw Error('validation_failed: scene mesh limit reached');
     this.models.set(args.id,model);this.selected=args.id;
    }else{
     const {root,target}=this.target(args.id);
     if(action==='model.remove'){
      if(target===root)this.models.delete(root.id);
      else {const descendants=new Set([target.id]);let size;do{size=descendants.size;for(const part of root.parts)if(descendants.has(part.parentId))descendants.add(part.id);}while(size!==descendants.size);root.parts=root.parts.filter(part=>!descendants.has(part.id));if(!root.parts.length)this.models.delete(root.id);}
      if(this.selected){try{this.target(this.selected);}catch{this.selected=null;}}
     }else if(action==='model.select')this.selected=args.id;
     else if(action==='model.setMaterial'){for(const item of target===root&&root.parts?root.parts:[target]){if(args.color)item.color=args.color;if(args.material)item.material=args.material;}}
     else if(action==='model.animate'){
      if(!this.settings.animations)throw Error('permission_denied: model animations are disabled');
      target.animation={property:args.property,from:[...target[args.property]],to:args.to,durationMs:args.durationMs,easing:args.easing,start:args.start,scopeId:context.scopeId||this.scope,token:require('node:crypto').randomUUID()};
     }else{delete target.animation;for(const key of ['position','rotation','scale'])if(args[key])target[key]=args[key];}
    }
    const ack=await this.render(context.signal);
    if(generation!==this.generation||context.signal?.aborted)throw Error('stale_turn: scene changed before acknowledgment');
    this.emit('change',this.status());return {accepted:true,rendered:ack.rendered===true,id:targetId||null,selected:this.selected,viewport:this.viewport,meshes:ack.meshes,coordinateSpace:'world-y-up',rotationUnit:'degrees',...(targetId&&this.models.has(targetId)?{model:this.status().models.find(model=>model.id===targetId)}:{})};
   }catch(error){
    if(generation===this.generation){Object.assign(this,previous);if(/renderer|WebGL|timeout|stale_turn/.test(error.message))this.clearImmediate(error.message);}
    throw error;
   }
  };
  const pending=this.serial.then(work);this.serial=pending.catch(()=>{});return pending;
 }
 interaction(change){
  try{
   if(change.type==='close'){this.clearImmediate('closed by user');return;}
   if(change.type==='viewport'){const bounds=change.bounds;for(const key of ['x','y','width','height'])schema.number(bounds[key],['x','y'].includes(key)?-100000:1,100000,key);const display=this.screen.getDisplayMatching?.(bounds)||this.screen.getAllDisplays().find(d=>bounds.x<d.bounds.x+d.bounds.width&&bounds.x+bounds.width>d.bounds.x&&bounds.y<d.bounds.y+d.bounds.height&&bounds.y+bounds.height>d.bounds.y);if(display)this.viewport={...bounds,displayId:String(display.id)};return;}
   const {root,target}=this.target(schema.id(change.id,true));
   if(change.type==='select'){this.selected=change.id;this.emit('change',this.status());return;}
   if(change.animationToken&&change.animationToken!==target.animation?.token)return;
   const transformed=Object.fromEntries(['position','rotation','scale'].map(key=>[key,schema.vector(change[key],key)]));Object.assign(target,transformed);
   delete target.animation;this.selected=change.id;this.models.set(root.id,root);this.emit('change',this.status());
  }catch(error){this.emit('diagnostic',error.message);}
 }
 beginScope(scope){this.cancelAnimations();this.scope=scope;this.speechPhase='finished';}
 cancelAnimations(){for(const model of this.models.values())for(const target of [model,...(model.parts||[])])delete target.animation;if(this.models.size)void this.queueRender();}
 queueRender(){const generation=this.generation;const pending=this.serial.then(()=>generation===this.generation?this.render():undefined);this.serial=pending.catch(error=>{if(generation===this.generation){this.emit('diagnostic',error.message);this.clearImmediate('renderer failure');}});return this.serial;}
 speech(phase,scopeId){if(scopeId&&scopeId!==this.scope)return;this.speechPhase=phase;if(phase==='cancelled')this.cancelAnimations();else if(this.models.size)void this.queueRender();}
 configure(patch){const previous=this.settings;this.settings=schema.settings(patch,this.settings);try{
  const count=[...this.models.values()].reduce((sum,model)=>sum+(model.parts?.length||model.asset?.meshes||1),0);
  if(!this.settings.enabled||this.models.size>this.settings.maxModels||count>this.settings.maxParts)this.clearImmediate('3D disabled or limit changed');
  else if(this.models.size){const displayId=this.displays().some(display=>display.id===this.settings.displayId)?this.settings.displayId:'primary';if(['displayId','width','height'].some(key=>Object.hasOwn(patch,key)))this.viewport=this.placement({displayId,width:this.settings.width,height:this.settings.height});if(!this.settings.animations)this.cancelAnimations();void this.queueRender();}
  return this.status();
 }catch(error){this.settings=previous;throw error;}}
 clearImmediate(reason='cleared'){this.generation++;this.models.clear();this.selected=null;this.viewport=null;this.adapter.reset();this.emit('change',this.status());this.emit('cleared',reason);}
 close(){this.clearImmediate('exit');this.adapter.close();}
}
module.exports={SceneManager};
