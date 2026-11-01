'use strict';
// Sandboxed text-file operations. Paths are always relative to a user-selected root.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {randomUUID,createHash}=crypto;
const MAX_FILE=256*1024;
const MAX_RESULTS=80;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function inside(root,file){const p=path.relative(root,file);return p===''||(!path.isAbsolute(p)&&p!=='..'&&!p.startsWith('..'+path.sep));}
function rootOf(root){if(!root||typeof root!=='string')throw Error('Select an approved working folder in Settings');const real=fs.realpathSync(root);if(!fs.statSync(real).isDirectory())throw Error('Working folder unavailable');return real;}
function locate(root,rel,{mustExist=true,kind=null}={}){
  if(typeof rel!=='string'||!rel||rel.length>1024||rel.includes('\0')||path.isAbsolute(rel)||/^[A-Za-z]:/.test(rel))throw Error('Invalid relative file path');
  const base=rootOf(root),target=path.resolve(base,rel);
  if(!inside(base,target))throw Error('Path escapes the approved working folder');
  // Check each existing ancestor with realpath; rejects symlink escapes for both read and write.
  let ancestor=target;
  while(!fs.existsSync(ancestor)){const parent=path.dirname(ancestor);if(parent===ancestor)throw Error('Parent folder unavailable');ancestor=parent;}
  const realAncestor=fs.realpathSync(ancestor);
  if(!inside(base,realAncestor))throw Error('Symlink escapes the approved working folder');
  if(mustExist&&!fs.existsSync(target))throw Error('File or folder does not exist');
  if(fs.existsSync(target)){
    const st=fs.lstatSync(target);if(st.isSymbolicLink())throw Error('Symlink targets cannot be edited');
    if(kind==='file'&&!st.isFile())throw Error('Not a regular file');
    if(kind==='directory'&&!st.isDirectory())throw Error('Not a directory');
  }
  return target;
}
function readText(root,rel){const file=locate(root,rel,{kind:'file'});if(/(?:^|[\/])(?:\.env(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:pem|p12|pfx)|credentials(?:\.[^\/]+)?)$/i.test(rel))throw Error('Sensitive credential files cannot be sent to ChatGPT');const st=fs.statSync(file);if(st.size>MAX_FILE)throw Error('File exceeds 256 KiB');const data=fs.readFileSync(file);let encoding='utf8',bom=false,text;
  if(data.length>=2&&data[0]===0xff&&data[1]===0xfe){encoding='utf16le';bom=true;text=data.subarray(2).toString(encoding);}
  else if(data.length>=2&&data[0]===0xfe&&data[1]===0xff){encoding='utf16be';bom=true;const b=Buffer.from(data.subarray(2));b.swap16();text=b.toString('utf16le');}
  else{bom=data.length>=3&&data.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]));const content=bom?data.subarray(3):data;if(content.includes(0)||!Buffer.from(content.toString('utf8'),'utf8').equals(content))throw Error('Binary or invalid UTF-8 content');text=content.toString('utf8');}
  return {file,bytes:data,text,sha256:hash(data),encoding,bom};
}
function encode(text,from){if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>MAX_FILE)throw Error('Text must not exceed 256 KiB');let b=Buffer.from(text,from.encoding==='utf16be'?'utf16le':from.encoding);if(from.encoding==='utf16be')b.swap16();if(from.bom)b=Buffer.concat([from.encoding==='utf16le'?Buffer.from([255,254]):from.encoding==='utf16be'?Buffer.from([254,255]):Buffer.from([239,187,191]),b]);return b;}
function atomicWrite(file,bytes,{existing=false}={}){const temp=path.join(path.dirname(file),`.cody-${randomUUID()}.tmp`);try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});if(existing){const st=fs.statSync(file);fs.chmodSync(temp,st.mode);}fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch{}}}
function backupPath(root,rel){const safe=locate(root,rel,{kind:'file'});const dir=locate(root,'.cody-backups',{mustExist:false});if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:false});const id=`${Date.now()}-${randomUUID().slice(0,8)}`;const out=path.join(dir,id+'.bak');fs.copyFileSync(safe,out,fs.constants.COPYFILE_EXCL);const meta={id,original:safeRel(root,safe),sha256:hash(fs.readFileSync(safe)),timestamp:new Date().toISOString()};fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify(meta),'utf8');return meta;}
function assertSHA(actual,expect){if(expect!==undefined&&(typeof expect!=='string'||!/^[0-9a-f]{64}$/.test(expect)||actual!==expect))throw Error('File changed since inspection (SHA-256 conflict)');}
function walk(root,sub='.',{limit=1200}={}){const dir=locate(root,sub,{kind:'directory'});const base=rootOf(root),out=[],queue=[dir];let n=0;while(queue.length&&out.length<limit){const curr=queue.shift();let entries=fs.readdirSync(curr,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));for(const x of entries){if(++n>limit)break;if(x.name==='.cody-backups'||x.name==='node_modules'||x.name==='.git')continue;const full=path.join(curr,x.name),relative=path.relative(base,full);if(x.isSymbolicLink())continue;out.push({path:relative.replace(/\\/g,'/'),kind:x.isDirectory()?'directory':x.isFile()?'file':'other'});if(x.isDirectory())queue.push(full);if(out.length>=limit)break;}}return out;}
function safeRel(root,file){return path.relative(rootOf(root),file).replace(/\\/g,'/');}
function validateArgs(action,args){if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Arguments must be an object');const str=(key,max=1024,optional=false)=>{const x=args[key];if(optional&&x===undefined)return undefined;if(typeof x!=='string'||x.length>max||!x.trim())throw Error(`Invalid ${key}`);return x;};switch(action){
 case 'file.list':return {path:args.path===undefined?'.':str('path')};
 case 'file.search':return {path:args.path===undefined?'.':str('path'),query:str('query',120),content:args.content===true};
 case 'file.read':case 'file.backup':return {path:str('path')};
 case 'file.create':case 'file.write':return {path:str('path'),text:args.text===undefined?'':(typeof args.text==='string'&&args.text.length<=MAX_FILE?args.text:(()=>{throw Error('Invalid text')})()),expectedSha256:str('expectedSha256',64,true)};
 case 'file.replace':case 'file.patch':return {path:str('path'),find:str('find',MAX_FILE),replace:args.replace===undefined?'':(typeof args.replace==='string'&&args.replace.length<=MAX_FILE?args.replace:(()=>{throw Error('Invalid replacement')})()),expectedSha256:str('expectedSha256',64,true)};
 case 'file.diff':return {path:str('path'),newText:str('newText',MAX_FILE)};
 case 'file.copy':case 'file.move':case 'file.rename':return {path:str('path'),destination:str('destination')};
 case 'file.restore':return {backupId:str('backupId',80),...(args.backupRoot!==undefined?{backupRoot:str('backupRoot')}:{})};
 case 'file.delete':return {path:str('path')};
 case 'folder.create':return {path:str('path')};
 default:throw Error('Unsupported file operation');}}
function executeFile(root,action,raw){const a=validateArgs(action,raw);const p=a.path;let old,source,target;
 switch(action){
 case 'file.list':{const dir=locate(root,p,{kind:'directory'});return fs.readdirSync(dir,{withFileTypes:true}).slice(0,MAX_RESULTS).map(x=>({name:x.name,kind:x.isDirectory()?'directory':x.isFile()?'file':'other'}));}
 case 'file.search':{const hits=[];for(const item of walk(root,a.path)){if(item.kind!=='file')continue;const hit=item.path.toLowerCase().includes(a.query.toLowerCase());if(hit){hits.push({path:item.path,match:'filename'});continue;}if(a.content){try{const f=readText(root,item.path);const idx=f.text.toLowerCase().indexOf(a.query.toLowerCase());if(idx>=0)hits.push({path:item.path,match:'content',excerpt:f.text.slice(Math.max(0,idx-70),idx+140)});}catch{}}if(hits.length>=MAX_RESULTS)break;}return hits;}
 case 'file.read':{old=readText(root,p);return {path:p,text:old.text,sha256:old.sha256,encoding:old.encoding,bom:old.bom};}
 case 'file.create':{target=locate(root,p,{mustExist:false});if(fs.existsSync(target))throw Error('File already exists');if(!fs.statSync(path.dirname(target)).isDirectory())throw Error('Parent folder does not exist');const b=encode(a.text,{encoding:'utf8',bom:false});fs.writeFileSync(target,b,{flag:'wx'});return {path:p,created:true,sha256:hash(b)};}
 case 'file.write':{old=readText(root,p);assertSHA(old.sha256,a.expectedSha256);const b=encode(a.text,old);const backup=backupPath(root,p);atomicWrite(old.file,b,{existing:true});return {path:p,sha256:hash(b),backupId:backup.id};}
 case 'file.replace':case 'file.patch':{old=readText(root,p);assertSHA(old.sha256,a.expectedSha256);const occurrences=old.text.split(a.find).length-1;if(occurrences!==1)throw Error(`Expected exactly one matching section, found ${occurrences}`);const updated=old.text.replace(a.find,a.replace);const b=encode(updated,old);const backup=backupPath(root,p);atomicWrite(old.file,b,{existing:true});return {path:p,changed:true,backupId:backup.id,sha256:hash(b),oldSha256:old.sha256};}
 case 'file.diff':{old=readText(root,p);const before=old.text.split(/\r?\n/),after=a.newText.split(/\r?\n/);let first=0;while(first<before.length&&first<after.length&&before[first]===after[first])first++;return {path:p,firstChangedLine:first+1,oldLines:before.slice(first,first+20),newLines:after.slice(first,first+20),sha256:old.sha256};}
 case 'file.backup':return backupPath(root,p);
 case 'file.restore':{if(!/^[0-9]+-[0-9a-f]{8}$/.test(a.backupId))throw Error('Invalid backup ID');const metaPath=locate(root,`.cody-backups/${a.backupId}.json`,{kind:'file'}),bytesPath=locate(root,`.cody-backups/${a.backupId}.bak`,{kind:'file'});const meta=JSON.parse(fs.readFileSync(metaPath,'utf8'));const original=locate(root,meta.original,{kind:'file'});const content=fs.readFileSync(bytesPath);if(hash(content)!==meta.sha256)throw Error('Backup checksum mismatch');const safety=backupPath(root,meta.original);atomicWrite(original,content,{existing:true});return {restored:safeRel(root,original),safetyBackupId:safety.id,sha256:hash(content)};}
 case 'file.copy':{source=locate(root,p,{kind:'file'});target=locate(root,a.destination,{mustExist:false});if(fs.existsSync(target))throw Error('Destination exists');fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);return {from:p,to:a.destination};}
 case 'file.move':case 'file.rename':{source=locate(root,p,{kind:'file'});target=locate(root,a.destination,{mustExist:false});if(fs.existsSync(target))throw Error('Destination exists');fs.renameSync(source,target);return {from:p,to:a.destination};}
 case 'file.delete':{source=locate(root,p,{kind:'file'});const backup=backupPath(root,p);fs.unlinkSync(source);return {deleted:p,backupId:backup.id};}
 case 'folder.create':{target=locate(root,p,{mustExist:false});if(fs.existsSync(target))throw Error('Directory already exists');fs.mkdirSync(target);return {created:p};}
 default:throw Error('Unsupported file operation');
 }}
module.exports={executeFile,readText,rootOf,locate,validateArgs,hash};
