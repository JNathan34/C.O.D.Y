'use strict';
const fs=require('node:fs'),path=require('node:path');
function inspectAsset(bytes){
 if(bytes.length>10*1024*1024)throw Error('validation_failed: model asset exceeds 10 MB');
 let json;
 if(bytes.readUInt32LE(0)===0x46546c67){
  if(bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw Error('validation_failed: malformed GLB');
  const length=bytes.readUInt32LE(12);if(length>bytes.length-20)throw Error('validation_failed: invalid GLB JSON chunk');json=JSON.parse(bytes.toString('utf8',20,20+length));
 }else json=JSON.parse(bytes.toString('utf8'));
 const primitives=(json.meshes||[]).reduce((count,mesh)=>count+(mesh.primitives?.length||0),0);
 if(json.asset?.version!=='2.0'||(json.nodes?.length||0)>256||(json.meshes?.length||0)>128||primitives>256||(json.materials?.length||0)>128||(json.images?.length||0)>32||(json.textures?.length||0)>64||(json.animations?.length||0)>16||(json.accessors||[]).some(a=>!Number.isInteger(a.count)||a.count<0||a.count>1000000))throw Error('validation_failed: unsupported or oversized glTF');
 if((json.extensionsUsed||[]).length||(json.extensionsRequired||[]).length)throw Error('validation_failed: compressed/extended assets require a separately vetted importer');
 const instances=(json.nodes||[]).reduce((count,node)=>count+(node.mesh===undefined?0:json.meshes?.[node.mesh]?.primitives?.length||0),0);
 if(instances>256)throw Error('validation_failed: too many model instances');
 for(const buffer of json.buffers||[])if(buffer.uri&&!/^data:application\/(?:octet-stream|gltf-buffer);base64,[A-Za-z0-9+/=]+$/.test(buffer.uri))throw Error('validation_failed: external model resources are forbidden');
 for(const image of json.images||[])if(image.uri||!['image/png','image/jpeg'].includes(image.mimeType)||!Number.isInteger(image.bufferView))throw Error('validation_failed: only embedded PNG/JPEG textures are supported');
 // Reject cycles before GLTFLoader traverses an untrusted hierarchy.
 const parented=new Set();for(const node of json.nodes||[])for(const child of node.children||[]){if(parented.has(child))throw Error('validation_failed: asset nodes must have a single parent');parented.add(child);}
 const visited=new Set();const visit=(index,chain=new Set())=>{if(chain.has(index)||!json.nodes?.[index]||chain.size>32)throw Error('validation_failed: cyclic, deep or missing asset node');if(visited.has(index))return;const next=new Set(chain).add(index);for(const child of json.nodes[index].children||[])visit(child,next);visited.add(index);};
 for(let i=0;i<(json.nodes?.length||0);i++)visit(i);
 return {format:bytes.readUInt32LE(0)===0x46546c67?'glb':'gltf',meshes:instances||primitives};
}
class AssetRegistry{
 constructor(root=path.join(__dirname,'../../assets/models')){this.root=root;this.registry=JSON.parse(fs.readFileSync(path.join(root,'registry.json'),'utf8'));}
 list(){return Object.entries(this.registry).map(([assetId,entry])=>({assetId,label:entry.label}));}
 load(assetId){
  const entry=Object.hasOwn(this.registry,assetId)&&this.registry[assetId];if(!entry)throw Error('target_not_found: unknown approved asset ID');
  const root=fs.realpathSync(this.root),file=fs.realpathSync(path.join(root,entry.file)),relative=path.relative(root,file);
  if(relative.startsWith('..')||path.isAbsolute(relative)||!['.glb','.gltf'].includes(path.extname(file)))throw Error('validation_failed: model asset escaped registry');
  const bytes=fs.readFileSync(file),metadata=inspectAsset(bytes);
  return {assetId,...metadata,base64:bytes.toString('base64')};
 }
}
module.exports={AssetRegistry,inspectAsset};
