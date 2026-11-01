// Adapted from the supplied original starter: real Three.js meshes, raycast
// picking, a camera-facing drag plane, right-drag rotation and wheel scaling.
import * as THREE from 'three';
import './kernel-runtime.js';
import '../vendor/clicky-three-parts.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const bridge=window.codyScene,canvas=document.getElementById('scene');
let renderer,scene,camera,revision=0,selected=null,gesture=null,frame=0,disposed=false,speechPhase='finished',animationEnabled=true;
const models=new Map(),targets=new Map(),animations=new Map(),picker=new THREE.Raycaster(),pointer=new THREE.Vector2();
const stats={frames:0,disposedGeometries:0,disposedMaterials:0,disposedTextures:0};let outline=null;
const radians=values=>values.map(THREE.MathUtils.degToRad),degrees=euler=>[euler.x,euler.y,euler.z].map(THREE.MathUtils.radToDeg);
function geometry(kind,recipe={}){
 if(['capsule','pipe','spring','gear'].includes(kind)){
  const data=globalThis.clickyThreeBuild(kind,JSON.stringify(recipe)),g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));
  if(data.uvs?.length)g.setAttribute('uv',new THREE.Float32BufferAttribute(data.uvs,2));if(data.indices?.length)g.setIndex(Array.from(data.indices));return g;
 }
 if(kind==='box')return new THREE.BoxGeometry(1,1,1);
 if(kind==='sphere')return new THREE.SphereGeometry(.65,24,16);
 if(kind==='cylinder')return new THREE.CylinderGeometry(.55,.55,1.4,24);
 if(kind==='cone')return new THREE.ConeGeometry(.6,1.4,24);
 if(kind==='torus')return new THREE.TorusGeometry(.6,.15,12,32);
 throw Error('Unsupported primitive');
}
function material(descriptor){
 const presets={standard:{roughness:.35,metalness:.18},matte:{roughness:1,metalness:0},metal:{roughness:.2,metalness:.85},glass:{roughness:.08,metalness:.05,transparent:true,opacity:.48,depthWrite:false}};
 return new THREE.MeshStandardMaterial({color:descriptor.color||'#009DFF',...presets[descriptor.material||'standard']});
}
function release(root){
 root.removeFromParent();const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
 root.traverse(node=>{if(node.geometry)geometries.add(node.geometry);if(node.skeleton)skeletons.add(node.skeleton);for(const entry of Array.isArray(node.material)?node.material:[node.material])if(entry){materials.add(entry);for(const value of Object.values(entry))if(value?.isTexture)textures.add(value);}});
 for(const value of geometries){value.dispose();stats.disposedGeometries++;}
 for(const value of materials){value.dispose();stats.disposedMaterials++;}
 for(const value of textures){value.source?.data?.close?.();value.dispose();stats.disposedTextures++;}
 for(const skeleton of skeletons)skeleton.dispose();
}
function setTransform(node,descriptor){
 const active=animations.get(node.userData.targetId);
 if(active?.property!=='position')node.position.fromArray(descriptor.position);
 if(active?.property!=='rotation')node.rotation.set(...radians(descriptor.rotation));
 if(active?.property!=='scale')node.scale.fromArray(descriptor.scale);
}
function clearOutline(){if(outline){release(outline);outline=null;}}
function select(id,report=false){
 selected=targets.has(id)?id:null;clearOutline();
 if(selected){outline=new THREE.BoxHelper(targets.get(selected),0x96eaff);outline.material.depthTest=false;outline.material.transparent=true;outline.material.opacity=.7;scene.add(outline);}
 document.getElementById('selection').textContent=selected||'Select a model';
 if(report&&selected)bridge.changed({revision,type:'select',id:selected});
}
function render(){if(disposed)return;scene.updateMatrixWorld(true);outline?.update();renderer.render(scene,camera);stats.frames++;}
function schedule(){if(!frame&&!disposed)frame=requestAnimationFrame(tick);}
function updateAnimations(now){
 let active=false;
 for(const [id,animation]of animations){
  const node=targets.get(id);if(!node){animations.delete(id);continue;}
  if(animation.start==='speech'&&speechPhase!=='playing'&&speechPhase!=='resumed'){animation.last=now;continue;}
  if(speechPhase==='paused'&&animation.start==='speech'){animation.last=now;continue;}
  animation.elapsed+=Math.max(0,now-animation.last);animation.last=now;
  const progress=Math.min(1,animation.elapsed/animation.durationMs),p=animation.easing==='smooth'?progress*progress*(3-2*progress):progress;
  if(animation.property==='rotation'){
   // Segment long rotations so 360° remains a visible full turn rather than
   // collapsing to the same start/end quaternion. Each short segment slerps.
   const count=Math.max(1,Math.ceil(Math.max(...animation.to.map((value,index)=>Math.abs(value-animation.from[index])))/90));
   const step=Math.min(count-1,Math.floor(p*count)),local=p*count-step;
   const a=animation.from.map((value,index)=>value+(animation.to[index]-value)*step/count),b=animation.from.map((value,index)=>value+(animation.to[index]-value)*(step+1)/count);
   animation.fromQ.setFromEuler(new THREE.Euler(...radians(a)));animation.toQ.setFromEuler(new THREE.Euler(...radians(b)));node.quaternion.slerpQuaternions(animation.fromQ,animation.toQ,local);
  }
  else node[animation.property].lerpVectors(animation.fromV,animation.toV,p);
  if(progress>=1){animations.delete(id);report(node,{animationToken:animation.token});}
  else active=true;
 }return active;
}
function tick(now){frame=0;const active=updateAnimations(now);render();if(active)schedule();}
function animate(node,descriptor){
 const id=node.userData.targetId,spec=descriptor.animation;
 if(!spec||!animationEnabled){animations.delete(id);return;}
 if(animations.get(id)?.token===spec.token)return;
 const value={...spec,elapsed:0,last:performance.now(),fromV:new THREE.Vector3().fromArray(spec.from),toV:new THREE.Vector3().fromArray(spec.to)};
 value.fromQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(...radians(spec.from)));value.toQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(...radians(spec.to)));animations.set(id,value);
}
function applyMaterial(root,descriptor){
 if(descriptor.color===undefined&&descriptor.material===undefined)return;
 root.traverse(node=>{if(!node.isMesh)return;const previous=Array.isArray(node.material)?node.material:[node.material];
  const key=JSON.stringify({color:descriptor.color||'#009DFF',material:descriptor.material||'standard'});
  if(node.userData.materialKey===key)return;node.userData.materialKey=key;node.material=material(descriptor);for(const item of previous){for(const value of Object.values(item))if(value?.isTexture){value.source?.data?.close?.();value.dispose();stats.disposedTextures++;}item.dispose();stats.disposedMaterials++;}
 });
}
async function construct(descriptor){
 const root=new THREE.Group();root.userData={rootId:descriptor.id,targetId:descriptor.id};const nodes=new Map();
 try{
  if(descriptor.asset){
   const bytes=Uint8Array.from(atob(descriptor.asset.base64),char=>char.charCodeAt(0));
   const loading=new THREE.LoadingManager();loading.setURLModifier(url=>{if(url.startsWith('blob:')||/^data:application\/(?:octet-stream|gltf-buffer);base64,/.test(url))return url;throw Error('External model resources are disabled');});
   const gltf=await new GLTFLoader(loading).parseAsync(descriptor.asset.format==='glb'?bytes.buffer:new TextDecoder().decode(bytes),'');
   root.add(gltf.scene);gltf.scene.traverse(node=>{node.userData.rootId=descriptor.id;node.userData.targetId=descriptor.id;});
  }else if(descriptor.parts){
   for(const part of descriptor.parts){const node=new THREE.Group();node.userData={rootId:descriptor.id,targetId:descriptor.id+':'+part.id};const mesh=new THREE.Mesh(geometry(part.primitive,part.recipe),material(part));mesh.userData={...node.userData};node.add(mesh);nodes.set(part.id,node);(part.parentId?nodes.get(part.parentId):root).add(node);}
  }else{const mesh=new THREE.Mesh(geometry(descriptor.primitive,descriptor.recipe),material(descriptor));mesh.userData={...root.userData};root.add(mesh);}
  return {root,nodes};
 }catch(error){release(root);throw error;}
}
function topology(model){return JSON.stringify({primitive:model.primitive,parts:model.parts?.map(({id,parentId,primitive})=>({id,parentId,primitive})),asset:model.asset?.base64});}
async function apply(state){
 gesture=null;revision=state.revision;const previousSpeech=speechPhase;speechPhase=state.speechPhase;animationEnabled=state.animations;
 if(!['playing','resumed'].includes(previousSpeech)&&['playing','resumed'].includes(speechPhase))for(const animation of animations.values())animation.last=performance.now();
 const desired=new Set(state.models.map(model=>model.id));
 clearOutline();
 for(const [id,entry]of models)if(!desired.has(id)){release(entry.root);models.delete(id);for(const key of targets.keys())if(key===id||key.startsWith(id+':')){targets.delete(key);animations.delete(key);}}
 for(const descriptor of state.models){
  const key=topology(descriptor);let entry=models.get(descriptor.id);
  if(!entry||entry.key!==key){if(entry){release(entry.root);for(const id of targets.keys())if(id===descriptor.id||id.startsWith(descriptor.id+':')){targets.delete(id);animations.delete(id);}}entry={...await construct(descriptor),key};models.set(descriptor.id,entry);scene.add(entry.root);targets.set(descriptor.id,entry.root);for(const [id,node]of entry.nodes)targets.set(descriptor.id+':'+id,node);}
  animate(entry.root,descriptor);setTransform(entry.root,descriptor);if(!descriptor.parts)applyMaterial(entry.root,descriptor);
  for(const part of descriptor.parts||[]){const node=entry.nodes.get(part.id);animate(node,part);setTransform(node,part);applyMaterial(node,part);}
 }
 select(state.selected);document.getElementById('title').textContent=state.name||'C.O.D.Y · 3D';
 updateAnimations(performance.now());render();if(animations.size)schedule();
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 let meshes=0;for(const entry of models.values())entry.root.traverse(node=>{if(node.isMesh)meshes++;});
 if(renderer.getContext().isContextLost())throw Error('WebGL context lost');
 return {revision:state.revision,ids:[...models.keys()],meshes};
}
function ray(event){const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);picker.setFromCamera(pointer,camera);return picker.ray;}
function hit(event){ray(event);scene.updateMatrixWorld(true);return picker.intersectObjects([...models.values()].map(item=>item.root),true).find(result=>result.object.isMesh)?.object;}
function report(node,extra={}){bridge.changed({revision,type:'transform',id:node.userData.targetId,position:node.position.toArray(),rotation:degrees(node.rotation),scale:node.scale.toArray(),...extra});}
canvas.addEventListener('contextmenu',event=>event.preventDefault());
canvas.addEventListener('pointerdown',event=>{
 if(event.shiftKey){gesture={pointerId:event.pointerId,mode:'orbit',lastX:event.clientX,lastY:event.clientY};canvas.setPointerCapture(event.pointerId);return;}
 const picked=hit(event);if(!picked){select(null);render();return;}
 const id=event.altKey?picked.userData.targetId:picked.userData.rootId,node=targets.get(id);if(!node)return;
 animations.delete(id);select(id,true);render();
 const world=node.getWorldPosition(new THREE.Vector3()),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()),world),at=new THREE.Vector3();
 if(!ray(event).intersectPlane(plane,at))return;
 gesture={pointerId:event.pointerId,mode:event.button===2?'rotate':'move',node,plane,offset:world.sub(at),lastX:event.clientX,lastY:event.clientY};canvas.setPointerCapture(event.pointerId);event.preventDefault();
});
canvas.addEventListener('pointermove',event=>{
 const g=gesture;if(!g||g.pointerId!==event.pointerId)return;const dx=event.clientX-g.lastX,dy=event.clientY-g.lastY;
 if(g.mode==='orbit'){const spherical=new THREE.Spherical().setFromVector3(camera.position);spherical.theta-=dx*.01;spherical.phi=THREE.MathUtils.clamp(spherical.phi+dy*.01,.15,Math.PI-.15);camera.position.setFromSpherical(spherical);camera.lookAt(0,0,0);}
 else if(g.mode==='rotate'){g.node.rotation.y+=dx*.012;g.node.rotation.x+=dy*.012;}
 else{const at=new THREE.Vector3();if(ray(event).intersectPlane(g.plane,at)){at.add(g.offset);g.node.parent.worldToLocal(at);for(const axis of ['x','y','z'])at[axis]=THREE.MathUtils.clamp(at[axis],-30,30);g.node.position.copy(at);}}
 g.lastX=event.clientX;g.lastY=event.clientY;render();
});
function end(event){if(!gesture||gesture.pointerId!==event.pointerId)return;if(gesture.node)report(gesture.node);gesture=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}
canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
canvas.addEventListener('wheel',event=>{const node=targets.get(selected);if(!node)return;event.preventDefault();animations.delete(selected);node.scale.multiplyScalar(event.deltaY>0?.93:1.075);for(const axis of ['x','y','z'])node.scale[axis]=THREE.MathUtils.clamp(node.scale[axis],.01,20);render();report(node);},{passive:false});
document.getElementById('close').addEventListener('click',()=>bridge.changed({revision,type:'close'}));
function resize(){if(!renderer)return;const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();render();}
window.addEventListener('resize',resize);
window.addEventListener('beforeunload',()=>{disposed=true;cancelAnimationFrame(frame);clearOutline();for(const item of models.values())release(item.root);models.clear();animations.clear();renderer?.dispose();renderer?.forceContextLoss();});
// Read-only diagnostics for native integration checks and support; no tool or
// privileged renderer API is exposed here.
window.CODYSceneDiagnostics=Object.freeze({snapshot:()=>{
 scene.updateMatrixWorld(true);const rect=canvas.getBoundingClientRect();
 return {webgl:!!renderer?.getContext(),revision,selected,speechPhase,animations:animations.size,triangles:renderer?.info.render.triangles,memory:renderer?.info.memory,stats:{...stats},models:[...targets].map(([id,node])=>{const at=node.getWorldPosition(new THREE.Vector3()).project(camera);return {id,position:node.position.toArray(),rotation:degrees(node.rotation),scale:node.scale.toArray(),screen:{x:rect.left+(at.x+1)*rect.width/2,y:rect.top+(1-at.y)*rect.height/2}};})};
}});
try{
 renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});renderer.setClearColor(0x000000,0);
 scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(42,1,.1,100);camera.position.set(3,2.5,6);camera.lookAt(0,0,0);
 scene.add(new THREE.HemisphereLight(0xbdefff,0x123344,2.2));const light=new THREE.DirectionalLight(0xffffff,2.6);light.position.set(4,7,5);scene.add(light);resize();
 canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();disposed=true;bridge.changed({revision,type:'close'});});
 let serial=Promise.resolve();bridge.onState(state=>{serial=serial.then(async()=>{try{bridge.acknowledge(await apply(state));}catch(error){bridge.acknowledge({revision:state.revision,error:String(error.message)});}});});bridge.ready();
}catch(error){bridge.ready('WebGL 2 is unavailable: '+error.message);}
