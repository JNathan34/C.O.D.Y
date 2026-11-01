'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
function cleanupUploads(directory){
 if(!directory||!fs.existsSync(directory))return;
 let root,entries;try{if(fs.lstatSync(directory).isSymbolicLink()||!fs.statSync(directory).isDirectory())return;root=fs.realpathSync(directory);entries=fs.readdirSync(root,{withFileTypes:true});}catch{return;}
 for(const entry of entries){
  if(!entry.isDirectory()||!/^capture-[A-Za-z0-9]{6}$/.test(entry.name))continue;
  const child=path.join(root,entry.name);try{
   if(fs.lstatSync(child).isSymbolicLink()||!fs.realpathSync(child).startsWith(root+path.sep))continue;
   for(const file of fs.readdirSync(child,{withFileTypes:true}))if(file.isFile()&&/^cody-vision-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i.test(file.name))fs.unlinkSync(path.join(child,file.name));
   if(!fs.readdirSync(child).length)fs.rmdirSync(child);
  }catch{/* in-use files are retried on the next app startup */}
 }
}
function composerImagesScript(){return `(() => {
 const editor=Array.from(document.querySelectorAll('#prompt-textarea,[data-testid="prompt-textarea"],[contenteditable="true"][data-lexical-editor="true"]')).find(node=>node.getClientRects().length);
 const form=editor?.closest('form');if(!form)return {ready:false,images:[],busy:false,error:'Composer is missing'};
 const images=Array.from(form.querySelectorAll('img')).filter(node=>!node.closest('[data-testid*="avatar"],[class*="avatar"]')&&(/^(blob:|data:image)/.test(node.src)||/estuary|attachment|uploaded/i.test(node.src+' '+node.alt))).map(node=>({src:node.src,complete:node.complete&&node.naturalWidth>0}));
 return {ready:true,images,busy:!!form.querySelector('[role="progressbar"],[aria-busy="true"]'),text:form.innerText||''};
})()`;}
function chooseImageInputScript(token){return `(() => {
 const editor=Array.from(document.querySelectorAll('#prompt-textarea,[data-testid="prompt-textarea"]')).find(node=>node.getClientRects().length),form=editor?.closest('form');
 const inputs=Array.from(document.querySelectorAll('input[type="file"]')).filter(node=>form&&(node.form===form||form.contains(node))&&!node.disabled&&!node.webkitdirectory&&(!node.accept||node.accept==='*/*'||node.accept==='*'||/image|\\.png|\\.jpe?g/i.test(node.accept)));
 const preferred=inputs.filter(node=>/image|\\.png|\\.jpe?g/i.test(node.accept));
 const candidates=preferred.length?preferred:inputs;
 if(candidates.length!==1){
  const button=form?.querySelector('button[data-testid="composer-plus-btn"],button[aria-label="Add photos & files"],button[aria-label="Add files and more"]');
  if(!inputs.length&&button&&button.getAttribute('aria-expanded')!=='true'){button.click();return {retry:true};}
  return {ok:false,why:'Could not identify one screenshot upload input. No message was sent.'};
 }
 candidates[0].setAttribute('data-cody-capture-input',${JSON.stringify(token)});return {ok:true};
})()`;}
async function attachImage(wc,image,{signal,cancelled=()=>false,root=path.join(os.tmpdir(),'cody-vision-uploads'),timeoutMs=20000}={}){
 if(!Buffer.isBuffer(image?.bytes)||image.bytes.length<8||image.bytes.length>8_000_000||image.bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('vision_unavailable: a trusted PNG capture is required');
 if(wc.debugger.isAttached())throw Error('vision_unavailable: close the ChatGPT session debugger before attaching a screenshot');
 const before=await wc.executeJavaScript(composerImagesScript(),true);
 if(!before.ready||before.images.length)throw Error('vision_unavailable: an existing attachment needs review in the ChatGPT session. No new message was sent.');
 fs.mkdirSync(root,{recursive:true});const directory=fs.mkdtempSync(path.join(root,'capture-')),file=path.join(directory,'cody-vision-'+randomUUID()+'.png');fs.writeFileSync(file,image.bytes);
 let ownsDebugger=false;
 const cleanup=async()=>{
  // Only the exact file/directory created above are removed; no recursive delete.
  for(let attempt=0;attempt<4;attempt++){try{if(fs.existsSync(file))fs.unlinkSync(file);if(fs.existsSync(directory))fs.rmdirSync(directory);return;}catch(error){if(attempt===3)throw Error('Could not remove the temporary screenshot: '+error.code);await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));}}
 };
 try{
  const token=randomUUID();let selected;
  for(let attempt=0;attempt<4;attempt++){if(signal?.aborted||cancelled())throw Error('Cancelled');selected=await wc.executeJavaScript(chooseImageInputScript(token),true);if(!selected.retry)break;await new Promise(resolve=>setTimeout(resolve,150));}
  if(!selected?.ok)throw Error('vision_unavailable: '+(selected?.why||'Screenshot input is unavailable'));
  wc.debugger.attach('1.3');ownsDebugger=true;
  const {root:document}=await wc.debugger.sendCommand('DOM.getDocument',{depth:0});
  const {nodeId}=await wc.debugger.sendCommand('DOM.querySelector',{nodeId:document.nodeId,selector:'input[data-cody-capture-input="'+token+'"]'});
  if(!nodeId)throw Error('vision_unavailable: screenshot input disappeared');
  await wc.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[file]});
  wc.debugger.detach();ownsDebugger=false;
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
   if(signal?.aborted||cancelled())throw Error('Cancelled');
   const state=await wc.executeJavaScript(composerImagesScript(),true);
   if(/upload failed|failed to upload|could not upload|upload limit|file too large|unsupported file/i.test(state.text||''))throw Error('vision_unavailable: ChatGPT did not accept the screenshot upload');
   if(state.ready&&!state.busy&&state.images.some(image=>image.complete))return {cleanup,filename:path.basename(file)};
   await new Promise(resolve=>setTimeout(resolve,120));
  }
  throw Error('vision_unavailable: screenshot upload was not confirmed. No message was sent.');
 }catch(error){await cleanup();throw error;}
 finally{try{if(ownsDebugger&&!wc.isDestroyed()&&wc.debugger.isAttached())wc.debugger.detach();}catch{/* renderer already closed */}}
}
module.exports={attachImage,composerImagesScript,chooseImageInputScript,cleanupUploads};
